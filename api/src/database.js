import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareDatabaseDirectory } from './config.js'

const defaultMigrations = fileURLToPath(new URL('../migrations/', import.meta.url))

export function openDatabase(databasePath) {
  const database = new Database(databasePath, { timeout: 5000 })
  try {
    database.pragma('foreign_keys = ON')
    const journalMode = database.pragma('journal_mode = WAL', { simple: true })
    if (journalMode !== 'wal') {
      throw new Error('Não foi possível ativar o modo WAL no SQLite.')
    }
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export function applyMigrations(database, directory = defaultMigrations) {
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
  if (files.length === 0 || files.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))) {
    throw new Error('As migrações devem usar nomes como 0001_esquema.sql.')
  }

  const migrate = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    const record = database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    const versions = new Set()
    let count = 0

    for (const file of files) {
      const version = file.slice(0, 4)
      if (versions.has(version)) {
        throw new Error(`Versão de migração repetida: ${version}.`)
      }
      versions.add(version)
      if (applied.get(version)) {
        continue
      }

      try {
        database.exec(readFileSync(join(directory, file), 'utf8'))
        record.run(version)
        count += 1
      } catch (error) {
        throw new Error(`Migração ${file} falhou: ${error.message}`, { cause: error })
      }
    }

    return count
  })

  return migrate.immediate()
}

export function migrateDatabase(databasePath) {
  prepareDatabaseDirectory(databasePath)
  const database = openDatabase(databasePath)
  try {
    return applyMigrations(database)
  } finally {
    database.close()
  }
}
