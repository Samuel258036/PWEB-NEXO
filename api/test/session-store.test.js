import assert from 'node:assert/strict'
import express from 'express'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createSessionMiddleware, SqliteSessionStore } from '../src/session-store.js'

function createDatabase(context, filePath = ':memory:') {
  const database = new DatabaseSync(filePath)
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  if (filePath === ':memory:') {
    context.after(() => database.close())
  }
  return database
}

function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      resolve(result)
    })
  })
}

function createSessionData(userId, expiresAt) {
  return { userId, cookie: { expires: new Date(expiresAt).toISOString(), maxAge: 1000 } }
}

test('persiste e recupera sessão, renova expiração e destrói pela chave', async (context) => {
  let currentTime = 1_800_000_000_000
  const database = createDatabase(context)
  const store = new SqliteSessionStore(database, { now: () => currentTime, cleanupInterval: 0x7fffffff })
  context.after(() => store.close())

  await callStore(store, 'set', 'sessao-1', createSessionData(7, currentTime + 1000))
  assert.deepEqual(await callStore(store, 'get', 'sessao-1'), createSessionData(7, currentTime + 1000))

  currentTime += 500
  await callStore(store, 'touch', 'sessao-1', createSessionData(7, currentTime + 5000))
  assert.equal(database.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sessao-1').expires_at, currentTime + 5000)

  await callStore(store, 'destroy', 'sessao-1')
  assert.equal(await callStore(store, 'get', 'sessao-1'), null)
})

test('não devolve sessões vencidas e remove os registros antigos', async (context) => {
  let currentTime = 1_800_000_000_000
  const database = createDatabase(context)
  const store = new SqliteSessionStore(database, { now: () => currentTime, cleanupInterval: 0x7fffffff })
  context.after(() => store.close())

  await callStore(store, 'set', 'expirada', createSessionData(9, currentTime - 1))
  assert.equal(await callStore(store, 'get', 'expirada'), null)
  await callStore(store, 'set', 'outra-expirada', createSessionData(9, currentTime - 1))
  assert.equal(store.cleanupExpired(), 1)
  currentTime += 1
  assert.equal(database.prepare('SELECT count(*) AS total FROM sessions').get().total, 0)
})

test('sessão continua disponível depois de fechar e reabrir o banco', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-session-'))
  const databasePath = join(directory, 'sessions.sqlite')

  const firstDatabase = createDatabase(context, databasePath)
  const firstStore = new SqliteSessionStore(firstDatabase, { cleanupInterval: 0x7fffffff })
  await callStore(firstStore, 'set', 'persistente', createSessionData(12, Date.now() + 60_000))
  firstStore.close()
  firstDatabase.close()

  const secondDatabase = new DatabaseSync(databasePath)
  const secondStore = new SqliteSessionStore(secondDatabase, { cleanupInterval: 0x7fffffff })
  context.after(() => {
    secondStore.close()
    secondDatabase.close()
    rmSync(directory, { recursive: true, force: true })
  })
  assert.equal((await callStore(secondStore, 'get', 'persistente')).userId, 12)
})

test('middleware retoma a sessão depois de reiniciar o servidor', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-session-restart-'))
  const databasePath = join(directory, 'sessions.sqlite')
  const secret = 'segredo-estavel-para-o-teste-de-reinicio'
  const firstDatabase = createDatabase(context, databasePath)
  const first = createSessionMiddleware({ database: firstDatabase, secret })
  const firstApp = express()
  firstApp.use(first.middleware)
  firstApp.get('/entrar', (request, response) => {
    request.session.userId = 31
    response.json({ userId: request.session.userId })
  })

  const firstServer = createServer(firstApp)
  await new Promise((resolve) => firstServer.listen(0, '127.0.0.1', resolve))
  const firstAddress = firstServer.address()
  const firstResponse = await fetch(`http://127.0.0.1:${firstAddress.port}/entrar`)
  const cookie = firstResponse.headers.get('set-cookie').split(';')[0]
  await new Promise((resolve) => firstServer.close(resolve))
  first.store.close()
  firstDatabase.close()

  const secondDatabase = new DatabaseSync(databasePath)
  const second = createSessionMiddleware({ database: secondDatabase, secret })
  const secondApp = express()
  secondApp.use(second.middleware)
  secondApp.get('/sessao', (request, response) => {
    response.json({ userId: request.session.userId ?? null })
  })
  const secondServer = createServer(secondApp)
  await new Promise((resolve) => secondServer.listen(0, '127.0.0.1', resolve))
  const secondAddress = secondServer.address()

  context.after(() => {
    second.store.close()
    secondDatabase.close()
    rmSync(directory, { recursive: true, force: true })
  })
  context.after(() => new Promise((resolve) => secondServer.close(resolve)))

  const resumedResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/sessao`, {
    headers: { cookie },
  })
  assert.deepEqual(await resumedResponse.json(), { userId: 31 })
})

test('middleware configura cookie seguro e regeneração troca o ID da sessão', async (context) => {
  const database = createDatabase(context)
  const app = createApp({
    database,
    sessionSecret: 'segredo-de-teste-longo',
    secureCookie: true,
    trustProxyHops: 1,
  })
  const store = app.locals.sessionStore
  context.after(() => store.close())
  app.get('/entrar', (request, response) => {
    request.session.userId = 21
    response.json({ userId: request.session.userId, sessionId: request.sessionID })
  })
  app.get('/sessao', (request, response) => {
    response.json({ userId: request.session.userId ?? null })
  })
  app.post('/regenerar', (request, response, next) => {
    request.session.regenerate((error) => {
      if (error) {
        next(error)
        return
      }
      request.session.userId = 22
      response.json({ userId: request.session.userId, sessionId: request.sessionID })
    })
  })

  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  const firstResponse = await fetch(`${origin}/entrar`, { headers: { 'x-forwarded-proto': 'https' } })
  const firstSession = await firstResponse.json()
  const firstCookie = firstResponse.headers.get('set-cookie')
  assert.match(firstCookie, /^nexo\.sid=/)
  assert.match(firstCookie, /HttpOnly/i)
  assert.match(firstCookie, /SameSite=Lax/i)
  assert.match(firstCookie, /Path=\//i)
  assert.match(firstCookie, /Secure/i)
  assert.match(firstCookie, /Expires=/i)
  const oldCookie = firstCookie.split(';')[0]

  const savedResponse = await fetch(`${origin}/sessao`, { headers: { cookie: oldCookie } })
  assert.deepEqual(await savedResponse.json(), { userId: 21 })
  const oldSessionId = firstSession.sessionId

  const regeneratedResponse = await fetch(`${origin}/regenerar`, {
    method: 'POST',
    headers: { cookie: oldCookie, 'x-forwarded-proto': 'https' },
  })
  const regeneratedSession = await regeneratedResponse.json()
  const newCookie = regeneratedResponse.headers.get('set-cookie').split(';')[0]
  const newSessionId = regeneratedSession.sessionId
  assert.notEqual(newSessionId, oldSessionId)
  assert.equal(await callStore(store, 'get', oldSessionId), null)
  const newSession = await fetch(`${origin}/sessao`, { headers: { cookie: newCookie } })
  assert.deepEqual(await newSession.json(), { userId: 22 })
})
