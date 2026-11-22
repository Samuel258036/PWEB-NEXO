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
