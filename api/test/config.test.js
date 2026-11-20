import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { prepareDatabaseDirectory, readConfig } from '../src/config.js'

const production = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://nexo.example',
  DATABASE_PATH: join(tmpdir(), 'nexo.sqlite'),
  SESSION_SECRET: ' exemplo descartável ',
}

test('configuração padrão local e valores explícitos de produção', () => {
  const local = readConfig({})
  assert.equal(local.port, 3000)
  assert.equal(local.appOrigin, 'http://localhost:5173')
  assert.match(local.databasePath, /data[\\/]nexo\.sqlite$/)

  const configured = readConfig(production)
  assert.equal(configured.production, true)
  assert.equal(configured.sessionSecret, production.SESSION_SECRET)

  for (const port of ['0', '70000', '99abc', ' 3000 ', '']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT/)
  }
  const originWithSlash = readConfig({ ...production, APP_ORIGIN: 'https://nexo.example/' })
  assert.equal(originWithSlash.appOrigin, production.APP_ORIGIN)
  for (const origin of ['https://nexo.example/path', 'https://nexo.example/?', 'https://x@nexo.example', 'http://nexo.example']) {
    assert.throws(() => readConfig({ ...production, APP_ORIGIN: origin }), /APP_ORIGIN/)
  }
  assert.throws(() => readConfig({ ...production, DATABASE_PATH: 'data/nexo.sqlite' }), /DATABASE_PATH/)
  assert.throws(() => readConfig({ ...production, SESSION_SECRET: ' ' }), /SESSION_SECRET/)
  if (process.platform === 'win32') {
    assert.throws(() => readConfig({ DATABASE_PATH: 'data/NUL.sqlite' }), /DATABASE_PATH/)
    assert.throws(() => readConfig({ DATABASE_PATH: 'data/arquivo?.sqlite' }), /DATABASE_PATH/)
  }
  assert.throws(() => prepareDatabaseDirectory(tmpdir()), /DATABASE_PATH/)
})

test('o ponto de entrada falha antes de ouvir quando a configuração é inválida', () => {
  const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url))
  const result = spawnSync(process.execPath, [serverPath], {
    env: { ...process.env, ...production, PORT: 'invalid' },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PORT/)
  assert.doesNotMatch(result.stderr, /exemplo descartável/)
  assert.equal(result.stdout, '')
})
