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
  const directory = mkdtempSync(join(tmpdir(), 'nexo-author-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)
  const accounts = []
  for (const username of ['autora', 'jogadora']) {
    const result = repositories.users.create({ usernameDisplay: username, usernameKey: username, passwordHash: await hashPassword('senha de teste segura') })
    accounts.push(result.lastInsertRowid)
  }
  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-autoria' })
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
  return { origin, accounts }
}

async function login(origin, username) {
  const initial = await fetch(`${origin}/api/auth/session`)
  const initialCookie = initial.headers.get('set-cookie').split(';')[0]
  const initialBody = await initial.json()
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie: initialCookie, 'x-csrf-token': initialBody.csrfToken },
    body: JSON.stringify({ username, password: 'senha de teste segura' }),
  })
  const body = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken }
}

async function authorRequest(origin, session, path, method = 'GET', body) {
  const headers = { cookie: session.cookie, origin }
  if (method !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrfToken
  }
  const response = await fetch(`${origin}${path}`, { method, headers, body: body && JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test('rascunho salva snapshot com IDs estáveis, renomeia e ordena etapas', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const first = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Primeiro nome' })
  const puzzleId = first.body.puzzle.id
  const created = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome atualizado', version: 1,
    steps: [{ prompt: 'A', answer: 'um' }, { prompt: 'B', answer: 'dois' }],
  })
  assert.equal(created.status, 200)
  const [stepA, stepB] = created.body.puzzle.steps
  const reordered = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome final', version: created.body.puzzle.version,
    steps: [{ id: stepB.id, prompt: 'B alterado', answer: 'dois' }, { id: stepA.id, prompt: 'A alterado', answer: 'um' }],
  })
  assert.equal(reordered.body.puzzle.steps[0].id, stepB.id)
  assert.equal(reordered.body.puzzle.steps[1].id, stepA.id)
  assert.deepEqual(reordered.body.puzzle.steps.map((step) => step.position), [1, 2])
  assert.equal(reordered.body.puzzle.name_display, 'Nome final')

  const foreignStep = await authorRequest(origin, other, '/api/author/puzzles', 'POST', { name: 'Outro rascunho' })
  const foreignContent = await authorRequest(origin, other, `/api/author/puzzles/${foreignStep.body.puzzle.id}/draft`, 'PUT', {
    name: 'Outro rascunho', version: 1, steps: [{ prompt: 'Privado', answer: 'privado' }],
  })
  const rejected = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome final', version: reordered.body.puzzle.version,
    steps: [{ id: foreignContent.body.puzzle.steps[0].id, prompt: '', answer: '' }],
  })
  assert.equal(rejected.status, 404)
})

test('publicação exige snapshot completo e congela a estrutura do rascunho', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const draft = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Publicável' })
  const puzzleId = draft.body.puzzle.id
  const emptyPublish = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', { expectedVersion: 1 })
  assert.equal(emptyPublish.status, 400)
  assert.equal(emptyPublish.body.error.code, 'DRAFT_INCOMPLETE')

  const snapshot = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Publicável', version: 1, steps: [{ prompt: 'Enunciado', answer: 'resposta' }],
  })
  const published = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', { expectedVersion: snapshot.body.puzzle.version })
  assert.equal(published.status, 200)
  assert.equal(published.body.puzzle.status, 'published')
  assert.ok(published.body.puzzle.published_at)

  const mutation = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Publicável', version: published.body.puzzle.version, steps: [],
  })
  assert.equal(mutation.status, 404)
})

test('autor lista, cria e retoma rascunho; outra conta não lê seu conteúdo', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const created = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Enigma de teste' })
  assert.equal(created.status, 201)
  assert.equal(created.body.puzzle.status, 'draft')
  assert.deepEqual(created.body.puzzle.steps, [])

  const id = created.body.puzzle.id
  const resumed = await authorRequest(origin, author, `/api/author/puzzles/${id}`)
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.puzzle.name_display, 'Enigma de teste')
  assert.deepEqual((await authorRequest(origin, author, '/api/author/puzzles')).body.puzzles.length, 1)
  assert.equal((await authorRequest(origin, other, `/api/author/puzzles/${id}`)).status, 404)
})
