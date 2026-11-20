import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { prepareDatabaseDirectory, readConfig } from './config.js'

try {
  const defaultMode = process.argv.includes('--production') ? 'production' : 'development'
  const config = readConfig(process.env, defaultMode)
  prepareDatabaseDirectory(config.databasePath)

  const buildDirectory = config.production
    ? fileURLToPath(new URL('../../web/dist/', import.meta.url))
    : undefined
  const app = createApp({ buildDirectory })
  const host = config.production ? undefined : '127.0.0.1'
  const server = app.listen(config.port, host, () => {
    console.log(`Nexo disponível na porta ${config.port}`)
  })
  server.on('error', (error) => {
    console.error(`Não foi possível iniciar o Nexo na porta ${config.port} (${error.code}).`)
    process.exitCode = 1
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
