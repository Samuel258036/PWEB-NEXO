import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { createApp } from './app.js'
import { readConfig } from './config.js'
import { migrateDatabase, openDatabase } from './database.js'

try {
  const defaultMode = process.argv.includes('--production') ? 'production' : 'development'
  const config = readConfig(process.env, defaultMode)
  if (!config.sessionSecret?.trim()) {
    throw new Error('SESSION_SECRET deve ser definida para manter as sessões após reiniciar o servidor.')
  }
  let buildDirectory
  if (config.production) {
    const build = new URL('../../web/dist/', import.meta.url)
    const index = statSync(new URL('index.html', build), { throwIfNoEntry: false })
    if (!index?.isFile()) {
      throw new Error('Build do frontend ausente. Execute npm run build antes de iniciar.')
    }
    buildDirectory = fileURLToPath(build)
  }
  migrateDatabase(config.databasePath)
  const database = openDatabase(config.databasePath)
  const app = createApp({
    buildDirectory,
    database,
    sessionSecret: config.sessionSecret,
    secureCookie: config.production,
    trustProxyHops: config.trustProxyHops,
    appOrigin: config.appOrigin,
  })
  const host = config.production ? undefined : '127.0.0.1'
  const server = app.listen(config.port, host)
  server.once('listening', () => {
    console.log(`Nexo disponível na porta ${config.port}`)
  })
  let resourcesClosed = false
  let shutdownTimer
  const closeResources = () => {
    if (resourcesClosed) {
      return
    }

    resourcesClosed = true
    clearTimeout(shutdownTimer)
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
    app.locals.sessionStore.close()
    database.close()
  }
  const shutdown = () => {
    if (shutdownTimer) return

    shutdownTimer = setTimeout(() => {
      console.error('O prazo de 10 segundos para encerrar o Nexo expirou.')
      server.closeAllConnections()
      closeResources()
      process.exit(1)
    }, 10_000)
    server.close()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  server.once('close', closeResources)
  server.on('error', (error) => {
    console.error(`Não foi possível iniciar o Nexo na porta ${config.port} (${error.code}).`)
    closeResources()
    process.exitCode = 1
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
