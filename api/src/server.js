import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { createApp } from './app.js'
import { readConfig } from './config.js'
import { migrateDatabase } from './database.js'

try {
  const defaultMode = process.argv.includes('--production') ? 'production' : 'development'
  const config = readConfig(process.env, defaultMode)
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
