import assert from 'node:assert/strict'
import { fork, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { on, once } from 'node:events'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const migrationCli = fileURLToPath(new URL('../src/migrate.js', import.meta.url))
const backupCli = fileURLToPath(new URL('../src/backup.js', import.meta.url))
const serverFixture = fileURLToPath(new URL('../test-support/graceful-server.js', import.meta.url))

async function getLoopbackPort() {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise((resolve) => reservation.close(resolve))
  return port
}

function cli(file, env, ...args) {
  const result = spawnSync(process.execPath, [file, ...args], {
    env, encoding: 'utf8', timeout: 10_000, windowsHide: true,
  })
  assert.ifError(result.error)
  return result
}

async function startServer(context, env) {
  const child = fork(serverFixture, [], { env, silent: true, windowsHide: true })
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
    child.kill()
    await exited
  })

  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  child.stdout.setEncoding('utf8')
  let stdout = ''
  const deadline = AbortSignal.timeout(5000)
  for await (const [chunk] of on(child.stdout, 'data', { signal: deadline, close: ['end'] })) {
    stdout += chunk
    if (stdout.includes('Nexo disponível na porta ' + env.PORT)) return child
  }
  throw new Error('O servidor não iniciou. ' + stderr)
}

function pendingExit(child) {
  return once(child, 'exit', { signal: AbortSignal.timeout(12_000) })
}

async function requestShutdown(child, signal) {
  const acknowledged = once(child, 'message', { signal: AbortSignal.timeout(5000) })
  child.send(signal)
  const [message] = await acknowledged
  assert.equal(message, 'encerrando')
}

async function api(origin, path, { session, data, status = 200 } = {}) {
  const headers = {}
  if (session) headers.cookie = session.cookie
  if (data !== undefined) {
    headers.origin = origin
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrfToken
  }
  const response = await fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(5000),
  })
  const body = await response.json()
  assert.equal(response.status, status, path + ' retornou ' + JSON.stringify(body))
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

async function register(origin, username) {
  const initial = await api(origin, '/api/auth/session')
  const { body, cookie } = await api(origin, '/api/auth/register', {
    session: { cookie: initial.cookie, csrfToken: initial.body.csrfToken },
    data: { username, password: 'senha temporaria da operacao', confirmedNew: true },
    status: 201,
  })
  return { cookie, csrfToken: body.csrfToken, user: body.user }
}

async function expectSessionAndProgress(origin, session, play) {
  await api(origin, '/api/health')
  const identity = await api(origin, '/api/auth/session', { session })
  assert.deepEqual(identity.body, { user: session.user, csrfToken: session.csrfToken })
  const resumed = await api(origin, '/api/play/puzzles/' + play.puzzle.id, { session })
  assert.deepEqual(resumed.body.play, play)
}

async function finishRequestDuringShutdown(origin, child, session) {
  const data = JSON.stringify({ username: session.user.usernameDisplay })
  const pending = request(origin + '/api/auth/identify', {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      origin, cookie: session.cookie, 'x-csrf-token': session.csrfToken,
      expect: '100-continue', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
    },
  })

  try {
    const continued = once(pending, 'continue')
    pending.flushHeaders()
    await continued
    pending.write(data.slice(0, 8))
    const exit = pendingExit(child)
    await requestShutdown(child, 'SIGTERM')
    const responded = once(pending, 'response')
    pending.end(data.slice(8))
    const [response] = await responded
    assert.equal(response.statusCode, 200)
    let body = ''
    for await (const chunk of response) body += chunk
    assert.deepEqual(JSON.parse(body), { state: 'existing' })
    assert.deepEqual(await exit, [0, null])
  } finally {
    pending.destroy()
  }
}

test('migra, copia banco ativo, drena requisição e restaura sessão e partida', { timeout: 30_000 }, async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-operations-'))
  const databasePath = join(directory, 'nexo.sqlite')
  const snapshotPath = join(directory, 'snapshot.sqlite')
  const restoredPath = join(directory, 'restaurado.sqlite')
  const port = await getLoopbackPort()
  const origin = 'http://127.0.0.1:' + port
  const env = {
    ...process.env, NODE_ENV: 'test', APP_ORIGIN: origin,
    PORT: String(port), DATABASE_PATH: databasePath, SESSION_SECRET: randomBytes(32).toString('hex'),
  }

  try {
    const missingSource = cli(backupCli, env, snapshotPath)
    assert.equal(missingSource.status, 1)
    assert.equal(existsSync(databasePath), false)
    assert.equal(existsSync(snapshotPath), false)

    const migration = cli(migrationCli, env)
    assert.equal(migration.status, 0, migration.stderr)
    assert.match(migration.stdout, /Migrações aplicadas: 1\./)
    const child = await startServer(context, env)

    const author = await register(origin, 'Autora Operação')
    const player = await register(origin, 'Jogadora Operação')
    const name = 'Lanterna da operação'
    const { body: draft } = await api(origin, '/api/author/puzzles', {
      session: author, status: 201, data: {
        name, steps: [
          { prompt: 'Primeira porta', answer: 'abrir' },
          { prompt: 'Segunda porta', answer: 'seguir', hints: [{ text: 'Observe a lanterna.' }] },
        ],
      },
    })
    const puzzlePath = '/api/play/puzzles/' + draft.puzzle.id
    await api(origin, '/api/author/puzzles/' + draft.puzzle.id + '/publish', {
      session: author, data: { expectedVersion: draft.puzzle.version },
    })
    const opened = await api(origin, '/api/play/puzzles/open', { session: player, data: { name } })
    const first = opened.body.play
    const answered = await api(origin, puzzlePath + '/answer', {
      session: player, data: { stepId: first.currentStep.id, expectedVersion: first.version, answer: 'abrir' },
    })
    assert.equal(answered.body.correct, true)
    const second = answered.body.play
    const revealed = await api(origin, puzzlePath + '/hints/reveal', {
      session: player, data: { stepId: second.currentStep.id, expectedVersion: second.version },
    })
    const saved = revealed.body.play
    assert.equal(saved.currentStep.position, 2)
    assert.equal(saved.currentStep.revealedHints[0].text, 'Observe a lanterna.')
    assert.ok(statSync(databasePath + '-wal').size > 32)

    const backup = cli(backupCli, env, snapshotPath)
    assert.equal(backup.status, 0, backup.stderr)
    assert.match(backup.stdout, /Backup criado e verificado/)
    const snapshotBytes = readFileSync(snapshotPath)
    const duplicate = cli(backupCli, env, snapshotPath)
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /destino do backup já existe/i)
    assert.deepEqual(readFileSync(snapshotPath), snapshotBytes)

    await finishRequestDuringShutdown(origin, child, player)
    const repeated = cli(migrationCli, env)
    assert.equal(repeated.status, 0, repeated.stderr)
    assert.match(repeated.stdout, /Migrações aplicadas: 0\./)

    const restarted = await startServer(context, env)
    await expectSessionAndProgress(origin, player, saved)
    const restartExit = pendingExit(restarted)
    await requestShutdown(restarted, 'SIGINT')
    assert.deepEqual(await restartExit, [0, null])

    copyFileSync(snapshotPath, restoredPath)
    const restored = new Database(restoredPath, { readonly: true, fileMustExist: true })
    try {
      assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok')
      assert.deepEqual(restored.pragma('foreign_key_check'), [])
      assert.deepEqual(restored.prepare('SELECT version FROM schema_migrations').pluck().all(), ['0001'])
    } finally {
      restored.close()
    }

    const recovered = await startServer(context, { ...env, DATABASE_PATH: restoredPath })
    await expectSessionAndProgress(origin, player, saved)
    const recoveredExit = pendingExit(recovered)
    await requestShutdown(recovered, 'SIGTERM')
    assert.deepEqual(await recoveredExit, [0, null])
  } finally {
    context.after(() => {
      for (const path of [databasePath, snapshotPath, restoredPath]) {
        for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(path + suffix, { force: true })
      }
      rmdirSync(directory)
    })
  }
})
