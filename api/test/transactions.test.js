import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createRepositories, VersionConflictError } from '../src/repositories.js'
import { runInImmediateTransaction } from '../src/transactions.js'

function createDatabase(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-transactions-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))

  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return database
}

function addUser(repositories, username) {
  const result = repositories.users.create({
    usernameDisplay: username,
    usernameKey: username.toLowerCase(),
    passwordHash: 'hash-de-teste',
  })
  return result.lastInsertRowid
}

function addPuzzle(repositories, authorId, name) {
  const result = repositories.puzzles.create({
    authorId,
    nameDisplay: name,
    nameKey: name.toLowerCase(),
  })
  return result.lastInsertRowid
}

function addProgress(repositories, database, userId, puzzleId) {
  const step = database.prepare('INSERT INTO steps (puzzle_id, position) VALUES (?, 1)').run(puzzleId)
  const progress = repositories.progress.create({
    userId,
    puzzleId,
    currentStepId: step.lastInsertRowid,
  })
  return progress.lastInsertRowid
}

test('falha dentro da transação reverte todas as escritas anteriores', (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const authorId = addUser(repositories, 'ana')
  const puzzleId = addPuzzle(repositories, authorId, 'Portal')

  assert.throws(() => runInImmediateTransaction(database, () => {
    database.prepare('UPDATE users SET username_display = ? WHERE id = ?').run('Ana alterada', authorId)
    database.prepare('UPDATE puzzles SET name_display = ? WHERE id = ?').run('Portal alterado', puzzleId)
    database.prepare('INSERT INTO puzzles (author_id, name_display, name_key) VALUES (?, ?, ?)')
      .run(authorId, 'Duplicado', 'portal')
  }), /UNIQUE/)

  assert.equal(database.prepare('SELECT username_display FROM users WHERE id = ?').get(authorId).username_display, 'ana')
  assert.equal(database.prepare('SELECT name_display FROM puzzles WHERE id = ?').get(puzzleId).name_display, 'Portal')
  assert.equal(database.prepare('SELECT count(*) AS count FROM puzzles').get().count, 1)
})

test('rejeita callback async antes de qualquer escrita ou retomada tardia', async (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const userId = addUser(repositories, 'ana')
  let resumed = false

  assert.throws(() => runInImmediateTransaction(database, async () => {
    await Promise.resolve()
    resumed = true
    database.prepare('UPDATE users SET username_display = ? WHERE id = ?').run('Ana alterada', userId)
  }), /não pode aguardar/)

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(resumed, false)
  assert.equal(database.prepare('SELECT username_display FROM users WHERE id = ?').get(userId).username_display, 'ana')
})

test('versão de enigma só incrementa quando autor e versão esperada coincidem', (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const authorId = addUser(repositories, 'ana')
  const otherUserId = addUser(repositories, 'bia')
  const puzzleId = addPuzzle(repositories, authorId, 'Portal')

  repositories.puzzles.incrementVersion({ puzzleId, authorId, expectedVersion: 1 })
  assert.equal(repositories.puzzles.findByIdForAuthor(puzzleId, authorId).version, 2)

  assert.throws(
    () => repositories.puzzles.incrementVersion({ puzzleId, authorId, expectedVersion: 1 }),
    VersionConflictError,
  )
  assert.throws(
    () => repositories.puzzles.incrementVersion({ puzzleId, authorId: otherUserId, expectedVersion: 2 }),
    VersionConflictError,
  )
  assert.equal(repositories.puzzles.findByIdForAuthor(puzzleId, authorId).version, 2)
})

test('versão de progresso só incrementa para a conta e a versão esperada', (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const userId = addUser(repositories, 'ana')
  const otherUserId = addUser(repositories, 'bia')
  const puzzleId = addPuzzle(repositories, userId, 'Portal')
  const progressId = addProgress(repositories, database, userId, puzzleId)

  repositories.progress.incrementVersion({ progressId, userId, expectedVersion: 1 })
  assert.equal(repositories.progress.findByUserAndPuzzle(userId, puzzleId).version, 2)

  assert.throws(
    () => repositories.progress.incrementVersion({ progressId, userId, expectedVersion: 1 }),
    VersionConflictError,
  )
  assert.throws(
    () => repositories.progress.incrementVersion({ progressId, userId: otherUserId, expectedVersion: 2 }),
    VersionConflictError,
  )
  assert.equal(repositories.progress.findByUserAndPuzzle(userId, puzzleId).version, 2)
})
