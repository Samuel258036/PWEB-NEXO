import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createRepositories } from '../src/repositories.js'
import { hashPassword } from '../src/passwords.js'

async function setup(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-play-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)
  const accounts = {}
  for (const username of ['autora', 'jogadora1', 'jogadora2']) {
    const result = repositories.users.create({
      usernameDisplay: username,
      usernameKey: username,
      passwordHash: await hashPassword('senha de teste segura'),
    })
    accounts[username] = Number(result.lastInsertRowid)
  }
  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-jogo' })
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
  return { origin, accounts, database }
}

async function login(origin, username) {
  const initial = await fetch(`${origin}/api/auth/session`)
  const initialCookie = initial.headers.get('set-cookie').split(';')[0]
  const initialBody = await initial.json()
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: initialCookie,
      'x-csrf-token': initialBody.csrfToken,
    },
    body: JSON.stringify({ username, password: 'senha de teste segura' }),
  })
  const body = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken }
}

async function apiRequest(origin, session, path, method = 'GET', body) {
  const headers = { cookie: session.cookie, origin }
  if (method !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrfToken
  }
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

test('resolve enigma publicado por nome normalizado, abre partida idempotente e oculta respostas/dicas', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'O Enigma da Torre' })
  assert.equal(created.status, 201)
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'O Enigma da Torre',
    version: 1,
    steps: [
      { prompt: 'Primeira pista', answer: 'chave-secreta' },
      { prompt: 'Segunda pista', answer: 'segunda-chave' },
    ],
  })
  assert.equal(saved.status, 200)

  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  assert.equal(published.status, 200)

  const firstStepId = published.body.puzzle.steps[0].id
  const addedHint = await apiRequest(origin, author, `/api/author/steps/${firstStepId}/hints`, 'POST', {
    text: 'Dica oculta inicial',
    expectedVersion: published.body.puzzle.version,
  })
  assert.equal(addedHint.status, 201)

  const firstOpen = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', {
    name: '  o enigma da torre  ',
  })
  assert.equal(firstOpen.status, 200)
  assert.deepEqual(firstOpen.payload?.play ?? firstOpen.body.play, {
    puzzle: { id: puzzleId, name: 'O Enigma da Torre' },
    status: 'in_progress',
    version: 1,
    currentStep: {
      id: firstStepId,
      position: 1,
      prompt: 'Primeira pista',
      revealedHints: [],
      hasMoreHints: true,
    },
    finalMessage: null,
  })

  const serialized = JSON.stringify(firstOpen.body)
  assert.equal(serialized.includes('chave-secreta'), false)
  assert.equal(serialized.includes('Segunda pista'), false)
  assert.equal(serialized.includes('Dica oculta inicial'), false)

  const secondOpen = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', {
    name: 'O ENIGMA DA TORRE',
  })
  assert.equal(secondOpen.status, 200)
  assert.deepEqual(secondOpen.body.play, firstOpen.body.play)
})

test('trata rascunho, inexistente e excluído como indisponíveis', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const draftRes = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Ainda em Rascunho' })
  assert.equal(draftRes.status, 201)

  const openDraft = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Ainda em Rascunho' })
  assert.equal(openDraft.status, 404)
  assert.equal(openDraft.body.error.code, 'PUZZLE_UNAVAILABLE')

  const openMissing = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Enigma Que Nao Existe' })
  assert.equal(openMissing.status, 404)
  assert.equal(openMissing.body.error.code, 'PUZZLE_UNAVAILABLE')

  const toDelete = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Enigma Efemero' })
  const deleteId = toDelete.body.puzzle.id
  const saved = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}/draft`, 'PUT', {
    name: 'Enigma Efemero',
    version: 1,
    steps: [{ prompt: 'Pergunta', answer: 'resposta' }],
  })
  const pub = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const del = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}`, 'DELETE', {
    confirmed: true,
    expectedVersion: pub.body.puzzle.version,
  })
  assert.equal(del.status, 200)

  const openDeleted = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Enigma Efemero' })
  assert.equal(openDeleted.status, 404)
  assert.equal(openDeleted.body.error.code, 'PUZZLE_UNAVAILABLE')
})

test('isola o progresso entre duas contas diferentes no mesmo enigma publicado', async (context) => {
  const { origin, accounts, database } = await setup(context)
  const author = await login(origin, 'autora')
  const playerA = await login(origin, 'jogadora1')
  const playerB = await login(origin, 'jogadora2')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Labirinto Compartilhado' })
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Labirinto Compartilhado',
    version: 1,
    steps: [
      { prompt: 'Etapa 1', answer: 'um' },
      { prompt: 'Etapa 2', answer: 'dois' },
    ],
  })
  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const [step1, step2] = published.body.puzzle.steps

  const openA = await apiRequest(origin, playerA, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  const openB = await apiRequest(origin, playerB, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  assert.equal(openA.status, 200)
  assert.equal(openB.status, 200)

  database.prepare(`
    UPDATE progress
    SET current_step_id = ?, version = version + 1
    WHERE puzzle_id = ? AND user_id = ?
  `).run(step2.id, puzzleId, accounts.jogadora1)

  const reopenA = await apiRequest(origin, playerA, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  const reopenB = await apiRequest(origin, playerB, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })

  assert.equal(reopenA.body.play.currentStep.id, step2.id)
  assert.equal(reopenA.body.play.version, 2)
  assert.equal(reopenB.body.play.currentStep.id, step1.id)
  assert.equal(reopenB.body.play.version, 1)
})