import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../api/src/app.js'
import { migrateDatabase, openDatabase } from '../api/src/database.js'

export async function startNexoHttps() {
  const buildDirectory = fileURLToPath(new URL('../web/dist/', import.meta.url))
  if (!statSync(join(buildDirectory, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Build do Nexo ausente. Execute npm run build.')
  }

  const directory = mkdtempSync(join(tmpdir(), 'nexo-e2e-'))
  const databasePath = join(directory, 'nexo.sqlite')
  const keyPath = join(directory, 'loopback.key')
  const certPath = join(directory, 'loopback.crt')
  const configPath = join(directory, 'openssl.cnf')
  let database
  let app
  let server

  async function close() {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    }

    app?.locals.sessionStore.close()
    database?.close()
    for (const path of [keyPath, certPath, configPath, databasePath, databasePath + '-wal', databasePath + '-shm']) {
      rmSync(path, { force: true })
    }
    rmdirSync(directory)
  }

  try {
    writeFileSync(configPath, '[req]\ndistinguished_name = dn\n[dn]\n')
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
      '-config', configPath,
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', keyPath, '-out', certPath,
    ], { windowsHide: true, stdio: 'pipe' })

    migrateDatabase(databasePath)
    database = openDatabase(databasePath)
    app = createApp({
      buildDirectory,
      database,
      sessionSecret: randomBytes(32).toString('hex'),
      secureCookie: true,
    })
    server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, app)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = 'https://127.0.0.1:' + server.address().port
    app.locals.appOrigin = origin
    return { origin, close }
  } catch (error) {
    await close()
    throw error
  }
}
