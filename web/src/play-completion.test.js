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

const DEFAULT_COMPLETION_MESSAGE = 'Enigma concluído.'

function resolveCompletionMessage(play) {
  const customMessage = typeof play?.finalMessage === 'string' ? play.finalMessage.trim() : ''
  return customMessage.length > 0 ? play.finalMessage : DEFAULT_COMPLETION_MESSAGE
}

async function setupCompletionApi(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-web-completion-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../../api/migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)

  for (const username of ['autora_fim', 'jogadora_fim']) {
    repositories.users.create({
      usernameDisplay: username,
      usernameKey: username,
      passwordHash: await hashPassword('senha de teste segura'),
    })
  }

  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-conclusao' })
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

test('conclui no último acerto, retorna a concluído ao reabrir e reflete mensagem final atualizada pelo autor', async (context) => {
  const { origin } = await setupCompletionApi(context)
  const author = await loginClient(origin, 'autora_fim')
  const player = await loginClient(origin, 'jogadora_fim')

  const created = await reqJson(origin, author, '/api/author/puzzles', 'POST', { name: 'Porta Final' })
  const puzzleId = created.body.puzzle.id

  const saved = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Porta Final',
    version: 1,
    steps: [{ prompt: 'Última chave', answer: 'abriu' }],
  })
  const pub = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const step1 = pub.body.puzzle.steps[0]

  const opened = await reqJson(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Porta Final' })
  assert.equal(opened.status, 200)

  // Último acerto sem mensagem personalizada usa mensagem padrão vigente
  const solved = await reqJson(origin, player, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step1.id,
    expectedVersion: opened.body.play.version,
    answer: 'abriu',
  })
  assert.equal(solved.status, 200)
  assert.equal(solved.body.correct, true)
  assert.equal(solved.body.play.status, 'completed')
  assert.equal(resolveCompletionMessage(solved.body.play), DEFAULT_COMPLETION_MESSAGE)

  // Reabrir o enigma volta direto para o estado concluído
  const reopenedCompleted = await reqJson(origin, player, '/api/play/puzzles/open', 'POST', {
    name: 'Porta Final',
  })
  assert.equal(reopenedCompleted.status, 200)
  assert.equal(reopenedCompleted.body.play.status, 'completed')

  // Autor atualiza a mensagem final e nova consulta exibe a mensagem vigente
  const latest = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}`)
  assert.equal(latest.status, 200)
  const updatedMsg = await reqJson(origin, author, `/api/author/puzzles/${puzzleId}/final-message`, 'PATCH', {
    finalMessage: 'Mensagem final atualizada pela autora.',
    expectedVersion: latest.body.puzzle.version,
  })
  assert.equal(updatedMsg.status, 200)

  const refreshedPlay = await reqJson(origin, player, `/api/play/puzzles/${puzzleId}`)
  assert.equal(refreshedPlay.status, 200)
  assert.equal(refreshedPlay.body.play.status, 'completed')
  assert.equal(
    resolveCompletionMessage(refreshedPlay.body.play),
    'Mensagem final atualizada pela autora.',
  )
})
