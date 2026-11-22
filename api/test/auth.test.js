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

async function createFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-auth-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)
  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-testes-de-auth' })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  app.locals.appOrigin = `http://127.0.0.1:${address.port}`

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    app.locals.sessionStore.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return { database, repositories, origin: `http://127.0.0.1:${address.port}` }
}

async function request(origin, path, { method = 'GET', body, cookie } = {}) {
  const headers = {}
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  if (cookie) {
    headers.cookie = cookie
  }

  headers.origin = origin
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const session = await fetch(`${origin}/api/auth/session`, { headers: cookie ? { cookie } : {} })
    const sessionBody = await session.json()
    headers['x-csrf-token'] = sessionBody.csrfToken
    if (!cookie) {
      cookie = session.headers.get('set-cookie')?.split(';')[0]
      if (cookie) headers.cookie = cookie
    }
  }

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const responseBody = await response.json()
  const setCookie = response.headers.get('set-cookie')

  return {
    status: response.status,
    body: responseBody,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    retryAfter: response.headers.get('retry-after'),
  }
}

function createUser(repositories, username, passwordHash) {
  return repositories.users.create({
    usernameDisplay: username,
    usernameKey: username.trim().toLowerCase(),
    passwordHash,
  }).lastInsertRowid
}

test('session e identify reconhecem nomes equivalentes sem criar conta', async (context) => {
  const { database, repositories, origin } = await createFixture(context)
  createUser(repositories, 'Caio', 'hash-de-teste')

  const session = await request(origin, '/api/auth/session')
  assert.equal(session.status, 200)
  assert.deepEqual(session.body.user, null)
  assert.match(session.body.csrfToken, /^[a-f\d]{64}$/)
  assert.ok(session.cookie)

  const existing = await request(origin, '/api/auth/identify', {
    method: 'POST',
    body: { username: '  CAIO  ' },
    cookie: session.cookie,
  })
  const unknown = await request(origin, '/api/auth/identify', {
    method: 'POST',
    body: { username: 'Marina' },
    cookie: session.cookie,
  })

  assert.deepEqual(existing.body, { state: 'existing' })
  assert.deepEqual(unknown.body, { state: 'new' })
  assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 1)
})

test('segurança adiciona Helmet, limite de autenticação e máximo de 2 MiB', async (context) => {
  const { origin } = await createFixture(context)
  const session = await request(origin, '/api/auth/session')
  const response = await fetch(`${origin}/api/auth/identify`, {
    method: 'POST',
    headers: {
      origin,
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.body.csrfToken,
    },
    body: JSON.stringify({ username: 'ana' }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN')

  let lastResponse
  for (let attempt = 0; attempt < 10; attempt += 1) {
    lastResponse = await request(origin, '/api/auth/identify', {
      method: 'POST', body: { username: 'ana' }, cookie: session.cookie,
    })
  }
  assert.equal(lastResponse.status, 429)
  assert.equal(lastResponse.body.error.code, 'RATE_LIMITED')
  assert.ok(Number(lastResponse.retryAfter) >= 0)

  const oversized = await fetch(`${origin}/api/auth/identify`, {
    method: 'POST',
    headers: {
      origin,
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.body.csrfToken,
    },
    body: JSON.stringify({ username: 'x'.repeat(2 * 1024 * 1024 + 1) }),
  })
  assert.equal(oversized.status, 413)
})

test('cadastro ausente ou sem confirmação não cria uma conta', async (context) => {
  const { database, origin } = await createFixture(context)
  const session = await request(origin, '/api/auth/session')
  const registration = {
    username: 'Bia',
    password: 'Senha particular 123!',
  }

  const missingConfirmation = await request(origin, '/api/auth/register', {
    method: 'POST',
    body: registration,
    cookie: session.cookie,
  })
  const refused = await request(origin, '/api/auth/register', {
    method: 'POST',
    body: { ...registration, confirmedNew: false },
    cookie: session.cookie,
  })

  assert.equal(missingConfirmation.status, 400)
  assert.equal(missingConfirmation.body.error.code, 'CONFIRMATION_REQUIRED')
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error.code, 'CONFIRMATION_REQUIRED')
  assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 0)
})

test('cadastros concorrentes com nomes equivalentes criam uma conta e uma sessão', async (context) => {
  const { database, origin } = await createFixture(context)
  const session = await request(origin, '/api/auth/session')
  const password = 'Senha privada de cadastro 123!'
  const firstRegistration = request(origin, '/api/auth/register', {
    method: 'POST',
    body: { username: ' NexoUser ', password, confirmedNew: true },
    cookie: session.cookie,
  })
  const secondRegistration = request(origin, '/api/auth/register', {
    method: 'POST',
    body: { username: 'nexouser', password, confirmedNew: true },
    cookie: session.cookie,
  })
  const results = await Promise.all([firstRegistration, secondRegistration])
  const created = results.find((result) => result.status === 201)
  const conflict = results.find((result) => result.status === 409)

  assert.ok(created)
  assert.ok(conflict)
  assert.equal(conflict.body.error.code, 'NAME_TAKEN')
  assert.ok(created.cookie)
  assert.notEqual(created.cookie, session.cookie)
  assert.notEqual(created.body.csrfToken, session.body.csrfToken)
  const savedUser = database.prepare('SELECT id, username_display FROM users').get()
  assert.deepEqual(created.body.user, { id: savedUser.id, usernameDisplay: savedUser.username_display })
  assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 1)
  assert.equal(database.prepare('SELECT count(*) AS count FROM sessions').get().count, 1)
  assert.equal(JSON.stringify(created.body).includes(password), false)
  assert.equal(JSON.stringify(created.body).includes('password_hash'), false)
})

test('login rejeita senha diferente sem autenticar e aceita senha literal correta', async (context) => {
  const { database, repositories, origin } = await createFixture(context)
  const password = 'Senha literal 987!'
  const passwordHash = await hashPassword(password)
  const userId = createUser(repositories, 'Ana', passwordHash)
  const session = await request(origin, '/api/auth/session')

  const wrongCase = await request(origin, '/api/auth/login', {
    method: 'POST',
    body: { username: ' ana ', password: 'senha literal 987!' },
    cookie: session.cookie,
  })
  const wrongSpaces = await request(origin, '/api/auth/login', {
    method: 'POST',
    body: { username: 'ANA', password: ` ${password} ` },
    cookie: session.cookie,
  })
  const missingAccount = await request(origin, '/api/auth/login', {
    method: 'POST',
    body: { username: 'inexistente', password },
    cookie: session.cookie,
  })
  const valid = await request(origin, '/api/auth/login', {
    method: 'POST',
    body: { username: ' ANA ', password },
    cookie: session.cookie,
  })

  for (const failure of [wrongCase, wrongSpaces, missingAccount]) {
    assert.equal(failure.status, 401)
    assert.equal(failure.body.error.code, 'AUTHENTICATION_FAILED')
    assert.equal(JSON.stringify(failure.body).includes(password), false)
  }
  assert.equal(valid.status, 200)
  assert.deepEqual(valid.body.user, { id: userId, usernameDisplay: 'Ana' })
  assert.notEqual(valid.cookie, session.cookie)
  assert.notEqual(valid.body.csrfToken, session.body.csrfToken)
  const resumedSession = await request(origin, '/api/auth/session', { cookie: valid.cookie })
  assert.deepEqual(resumedSession.body.user, { id: userId, usernameDisplay: 'Ana' })
  assert.equal(resumedSession.body.csrfToken, valid.body.csrfToken)
  assert.equal(JSON.stringify(valid.body).includes(password), false)
  assert.equal(JSON.stringify(valid.body).includes(passwordHash), false)
  assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 1)
})
