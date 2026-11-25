import Database from 'better-sqlite3'
import { chmodSync, linkSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readConfig } from './config.js'

async function backupDatabase(sourcePath, destination) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true, timeout: 5000 })
  let stagingDirectory
  try {
    stagingDirectory = mkdtempSync(join(dirname(destination), '.nexo-backup-'))
    const snapshotPath = join(stagingDirectory, 'snapshot.sqlite')
    await source.backup(snapshotPath)
    chmodSync(snapshotPath, 0o600)

    const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
    try {
      const integrity = snapshot.pragma('integrity_check', { simple: true })
      const foreignKeys = snapshot.pragma('foreign_key_check')
      if (integrity !== 'ok' || foreignKeys.length !== 0) {
        throw new Error('A cópia do SQLite falhou na verificação de integridade.')
      }
    } finally {
      snapshot.close()
    }

    // O link só publica o arquivo completo e falha se o destino já existir.
    linkSync(snapshotPath, destination)
  } finally {
    source.close()
    if (stagingDirectory) {
      const snapshotPath = join(stagingDirectory, 'snapshot.sqlite')
      for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(snapshotPath + suffix, { force: true })
      rmdirSync(stagingDirectory)
    }
  }
}

try {
  const [destination] = process.argv.slice(2)
  if (!destination?.trim() || process.argv.length !== 3 || !process.env.DATABASE_PATH?.trim()) {
    throw new Error('Defina DATABASE_PATH e execute npm run backup -- <arquivo-destino>.')
  }

  const { databasePath } = readConfig(process.env)
  await backupDatabase(databasePath, resolve(destination))
  console.log('Backup criado e verificado.')
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'O destino do backup já existe.' : error.message)
  process.exitCode = 1
}
