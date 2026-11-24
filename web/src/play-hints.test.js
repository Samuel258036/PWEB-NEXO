import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createApp } from '../../api/src/app.js'
import { createRepositories } from '../../api/src/repositories.js'
import { hashPassword } from '../../api/src/passwords.js'

function isHintCommand(rawValue) {
  return typeof rawValue === 'string' && rawValue.trim().toLowerCase() === '/dica'
}

function deriveHintPresentation(play) {
  const step = play?.currentStep
  if (!step) {
    return { revealedHints: [], exhausted: false }
  }
  return {
    revealedHints: step.revealedHints ?? [],
    exhausted: step.hasMoreHints === false,
  }
}

async function setupPlayApi(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-web-hints-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../../api/migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)

  for (const username of ['autora_dica', 'jogadora_dica']) {
    repositories.users.create({
      usernameDisplay: username,
      usernameKey: username,
      passwordHash: await hashPassword('senha de teste segura'),
    })
  }

  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-dicas' })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  app.locals.appOrigin = origin

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    app.locals.sessionStore.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return { origin }
}

async function loginClient(origin, username) {
  const initial = await fetch(`${origin}/api/auth/session`)
  const cookie = initial.headers.get('set-cookie').split(';')[0]
  const initialBody = await initial.json()
  const res = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': initialBody.csrfToken,
    },
    body: JSON.stringify({ username, password: 'senha de teste segura' }),
  })
  const body = await res.json()
  return { cookie: res.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken }
}

async function reqJson(origin, session, path, method = 'GET', body) {
  const headers = { cookie: session.cookie, origin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['x-csrf-token'] = session.csrfToken
  const res = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

test('revela dica via /dica, indica esgotamento e retoma dicas reveladas em novo acesso pela API real', async (context) => {
  assert.equal(isHintCommand('/dica'), true)
  assert.equal(isHintCommand('  /DICA  '), true)
  assert.equal(isHintCommand('outra coisa'), false)

  const { origin } = await setupPlayApi(context)
  const author = await loginClient(origin, 'autora_dica')
  const player1 = await loginClient(origin, 'jogadora_dica')

  const created = await reqJson(origin, author, '/api/author/puzzles', 'POST', { name: 'Enigma das Dicas' })
  const puzzleId = created.body.puzzle.id

  const saved = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Enigma das Dicas',
    version: 1,
    steps: [
      { prompt: 'Encontre a chave', answer: 'chave' },
      { prompt: 'Etapa final', answer: 'fim' },
    ],
  })
  const pub = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const step1Id = pub.body.puzzle.steps[0].id

  const hintRes = await reqJson(origin, author, `/api/author/steps/${step1Id}/hints`, 'POST', {
    text: 'Está na estante superior',
    expectedVersion: pub.body.puzzle.version,
  })
  assert.equal(hintRes.status, 201)

  const open1 = await reqJson(origin, player1, '/api/play/puzzles/open', 'POST', { name: 'Enigma das Dicas' })
  assert.equal(open1.status, 200)
  assert.deepEqual(deriveHintPresentation(open1.body.play), {
    revealedHints: [],
    exhausted: false,
  })

  const reveal1 = await reqJson(origin, player1, `/api/play/puzzles/${puzzleId}/hints/reveal`, 'POST', {
    stepId: step1Id,
    expectedVersion: open1.body.play.version,
  })
  assert.equal(reveal1.status, 200)
  assert.deepEqual(deriveHintPresentation(reveal1.body.play), {
    revealedHints: [{ id: hintRes.body.hints[0].id, position: 1, text: 'Está na estante superior' }],
    exhausted: true,
  })

  // Novo acesso (nova sessão/cliente para a mesma conta) retoma a dica já revelada e o esgotamento
  const player1NewAccess = await loginClient(origin, 'jogadora_dica')
  const reopened = await reqJson(origin, player1NewAccess, '/api/play/puzzles/open', 'POST', {
    name: 'Enigma das Dicas',
  })
  assert.equal(reopened.status, 200)
  assert.deepEqual(deriveHintPresentation(reopened.body.play), {
    revealedHints: [{ id: hintRes.body.hints[0].id, position: 1, text: 'Está na estante superior' }],
    exhausted: true,
  })
})