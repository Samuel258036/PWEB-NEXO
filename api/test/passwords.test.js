import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hashPassword,
  PasswordHashQueueFullError,
  verifyPassword,
} from '../src/passwords.js'

test('hash usa salt próprio e verifica senha sem normalizar texto', async () => {
  const password = 'Senha Exata 123!'
  const firstHash = await hashPassword(password)
  const secondHash = await hashPassword(password)

  assert.match(firstHash, /^scrypt\$v=1\$N=131072\$r=8\$p=1\$[a-f\d]{32,}\$[a-f\d]{128}$/)
  assert.notEqual(firstHash, secondHash)
  assert.equal(await verifyPassword(password, firstHash), true)
  assert.equal(await verifyPassword('senha Exata 123!', firstHash), false)
  assert.equal(await verifyPassword(' Senha Exata 123!', firstHash), false)
  assert.equal(await verifyPassword('Senha Exata 123! ', firstHash), false)
  assert.equal(await verifyPassword('incorreta 123!', firstHash), false)
})

test('formato inválido não autentica e validação não revela a senha', async () => {
  const password = 'Senha Segura 456!'

  assert.throws(() => hashPassword('curta'), (error) => {
    assert.equal(error.code, 'INVALID_FIELD')
    assert.equal(error.message.includes('curta'), false)
    return true
  })

  assert.equal(await verifyPassword(password, 'não-é-um-hash'), false)
  assert.equal(await verifyPassword('curta', 'scrypt$v=1$hash-inválido'), false)
})

test('limita hashes a um ativo e quatro em espera', async () => {
  const encodedHash = await hashPassword('Fila segura 789!')
  const first = verifyPassword('Fila segura 789!', encodedHash)
  const waiting = [
    verifyPassword('Fila segura 789!', encodedHash),
    verifyPassword('Fila segura 789!', encodedHash),
    verifyPassword('Fila segura 789!', encodedHash),
    verifyPassword('Fila segura 789!', encodedHash),
  ]
  const overflow = verifyPassword('Fila segura 789!', encodedHash)

  await assert.rejects(overflow, (error) => {
    assert.ok(error instanceof PasswordHashQueueFullError)
    assert.equal(error.code, 'PASSWORD_HASH_QUEUE_FULL')
    assert.equal(error.message.includes('Fila segura'), false)
    return true
  })

  assert.equal(await first, true)
  assert.deepEqual(await Promise.all(waiting), [true, true, true, true])
})

test('não expõe senha nos valores retornados ou em logs', async () => {
  const password = 'Não Registrar 321!'
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  const calls = []
  console.log = (...values) => calls.push(values)
  console.warn = (...values) => calls.push(values)
  console.error = (...values) => calls.push(values)

  try {
    const encodedHash = await hashPassword(password)
    const matches = await verifyPassword(password, encodedHash)
    assert.equal(JSON.stringify({ passwordHash: encodedHash }).includes(password), false)
    assert.equal(JSON.stringify({ matches }).includes(password), false)
    assert.deepEqual(calls, [])
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
  }
})
