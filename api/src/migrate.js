import { readConfig } from './config.js'
import { migrateDatabase } from './database.js'

try {
  const config = readConfig(process.env)
  const appliedCount = migrateDatabase(config.databasePath)
  console.log(`Migrações aplicadas: ${appliedCount}.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
