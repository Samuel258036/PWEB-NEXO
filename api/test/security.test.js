import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequestSecurity, requireAuthenticatedSession } from '../src/security.js'

test('mutações exigem origem e token CSRF válidos', async () => {
  const protect = createRequestSecurity({ appOrigin: 'https://nexo.example' })
  async function run(origin, token) {
    const request = { method: 'POST', get: (name) => name === 'origin' ? origin : token, session: { csrfToken: 'abc123' } }
    const result = { status: 200, body: null }
    const response = { status(code) { result.status = code; return this }, json(body) { result.body = body } }
    let continued = false
    protect(request, response, () => { continued = true })
    return { ...result, continued }
  }
  assert.equal((await run(undefined, 'abc123')).status, 403)
  assert.equal((await run('https://nexo.example', 'ruim')).status, 403)
  assert.equal((await run('https://nexo.example', 'abc123')).continued, true)
})

test('rotas privadas respondem 401 sem sessão autenticada', () => {
  const result = { status: 200 }
  const response = { status(code) { result.status = code; return this }, json() {} }
  requireAuthenticatedSession({ session: {} }, response, () => {})
  assert.equal(result.status, 401)
})
