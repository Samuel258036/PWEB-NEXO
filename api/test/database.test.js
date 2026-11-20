import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyMigrations, migrateDatabase, openDatabase } from '../src/database.js'

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-db-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('aplicar duas vezes registra uma versão e os dados persistem ao reabrir', (context) => {
  const path = join(temporaryDirectory(context), 'nexo.sqlite')
  assert.equal(migrateDatabase(path), 1)

  const database = openDatabase(path)
  try {
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal')
    assert.equal(database.pragma('busy_timeout', { simple: true }), 5000)
    database.exec("INSERT INTO users (username_display, username_key, password_hash) VALUES ('Ana', 'ana', 'hash-de-teste')")
  } finally {
    database.close()
  }

  assert.equal(migrateDatabase(path), 0)
  const reopened = openDatabase(path)
  try {
    assert.deepEqual(reopened.prepare('SELECT version FROM schema_migrations').all(), [{ version: '0001' }])
    assert.deepEqual(reopened.prepare('SELECT username_display FROM users').all(), [{ username_display: 'Ana' }])
  } finally {
    reopened.close()
  }
})

test('a etapa atual precisa pertencer ao enigma e a exclusão remove os dados dependentes', (context) => {
  const path = join(temporaryDirectory(context), 'nexo.sqlite')
  migrateDatabase(path)
  const database = openDatabase(path)

  try {
    database.exec(`
      INSERT INTO users (id, username_display, username_key, password_hash)
        VALUES (1, 'Ana', 'ana', 'hash-de-teste');
      INSERT INTO puzzles (id, author_id, name_display, name_key)
        VALUES (1, 1, 'Nexo A', 'a'), (2, 1, 'Nexo B', 'b');
      INSERT INTO steps (id, puzzle_id, position) VALUES (1, 1, 1), (2, 2, 1);
      INSERT INTO hints (id, step_id, position, text) VALUES (1, 1, 1, 'Dica');
    `)

    const start = database.prepare('INSERT INTO progress (user_id, puzzle_id, current_step_id) VALUES (1, 1, ?)')
    assert.throws(() => start.run(2), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
    const result = start.run(1)
    database.prepare('INSERT INTO step_solves (progress_id, step_id) VALUES (?, 1)').run(result.lastInsertRowid)
    database.prepare('INSERT INTO hint_reveals (progress_id, hint_id) VALUES (?, 1)').run(result.lastInsertRowid)

    database.exec('DELETE FROM puzzles WHERE id = 1')
    const counts = database.prepare(`
      SELECT (SELECT count(*) FROM steps WHERE puzzle_id = 1) AS steps,
             (SELECT count(*) FROM hints) AS hints,
             (SELECT count(*) FROM progress) AS progress,
             (SELECT count(*) FROM step_solves) AS solves,
             (SELECT count(*) FROM hint_reveals) AS reveals
    `).get()
    assert.deepEqual(counts, { steps: 0, hints: 0, progress: 0, solves: 0, reveals: 0 })
    assert.equal(database.prepare('SELECT count(*) FROM users').pluck().get(), 1)
    assert.equal(database.prepare('SELECT count(*) FROM puzzles').pluck().get(), 1)
    assert.equal(database.prepare('SELECT count(*) FROM steps').pluck().get(), 1)
    assert.deepEqual(database.pragma('foreign_key_check'), [])

    const recreated = database.prepare(
      "INSERT INTO puzzles (author_id, name_display, name_key) VALUES (1, 'Nexo A', 'a')",
    ).run()
    assert.ok(recreated.lastInsertRowid > 2)
  } finally {
    database.close()
  }
})

test('uma migração que falha desfaz o lote pendente inteiro', (context) => {
  const directory = temporaryDirectory(context)
  const database = openDatabase(join(directory, 'nexo.sqlite'))
  try {
    writeFileSync(join(directory, '0001_create.sql'), 'CREATE TABLE sample (id INTEGER PRIMARY KEY);')
    writeFileSync(join(directory, '0002_failure.sql'), 'CREATE TABLE sample (id INTEGER PRIMARY KEY);')

    assert.throws(() => applyMigrations(database, directory), /0002_failure\.sql/)
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), [])

    writeFileSync(join(directory, '0002_failure.sql'), 'INSERT INTO sample (id) VALUES (1);')
    assert.equal(applyMigrations(database, directory), 2)
    assert.equal(applyMigrations(database, directory), 0)
    assert.deepEqual(database.prepare('SELECT id FROM sample').all(), [{ id: 1 }])
  } finally {
    database.close()
  }
})

test('um esquema incompatível impede o servidor de abrir a porta', (context) => {
  const path = join(temporaryDirectory(context), 'nexo.sqlite')
  const database = openDatabase(path)
  try {
    database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY);')
  } finally {
    database.close()
  }

  const server = fileURLToPath(new URL('../src/server.js', import.meta.url))
  const result = spawnSync(process.execPath, [server], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '49383',
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_PATH: path,
    },
    encoding: 'utf8',
    timeout: 5000,
  })

  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Migração 0001_initial_schema\.sql falhou/)
  assert.equal(result.stdout, '')
})
