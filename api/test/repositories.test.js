import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { validatePuzzleName } from '../src/validation.js'
import { createRepositories, RepositoryReferenceError } from '../src/repositories.js'

function createDatabase(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-repositories-'))
  const databasePath = join(directory, 'nexo.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))

  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return database
}

function createUser(repositories, username) {
  return repositories.users.create({
    usernameDisplay: username,
    usernameKey: username.toLowerCase(),
    passwordHash: 'hash-de-teste',
  }).lastInsertRowid
}

function createPuzzle(repositories, authorId, name) {
  const validatedName = validatePuzzleName(name)
  return repositories.puzzles.create({
    authorId,
    nameDisplay: validatedName.display,
    nameKey: validatedName.key,
  }).lastInsertRowid
}

test('reservas equivalentes usam a chave normalizada e o UNIQUE impede duplicidade', (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const authorId = createUser(repositories, 'ana')
  const otherAuthorId = createUser(repositories, 'bia')
  const firstPuzzleId = createPuzzle(repositories, authorId, 'Portal')

  assert.equal(repositories.puzzles.findByIdForAuthor(firstPuzzleId, authorId).id, firstPuzzleId)
  assert.equal(repositories.puzzles.findByIdForAuthor(firstPuzzleId, otherAuthorId), undefined)
  assert.throws(() => createPuzzle(repositories, authorId, ' portal '), /UNIQUE/)
  assert.equal(database.prepare('SELECT count(*) AS count FROM puzzles').get().count, 1)
})

test('leituras de enigma são limitadas à autoria e recursos usam referências válidas', (context) => {
  const database = createDatabase(context)
  const repositories = createRepositories(database)
  const anaId = createUser(repositories, 'ana')
  const biaId = createUser(repositories, 'bia')
  const anaPuzzleId = createPuzzle(repositories, anaId, 'Nexo da Ana')
  const biaPuzzleId = createPuzzle(repositories, biaId, 'Nexo da Bia')
  const createStep = database.prepare('INSERT INTO steps (puzzle_id, position) VALUES (?, 1)')
  const anaStepId = createStep.run(anaPuzzleId).lastInsertRowid
  const biaStepId = createStep.run(biaPuzzleId).lastInsertRowid
  const createHint = database.prepare('INSERT INTO hints (step_id, position, text) VALUES (?, 1, ?)')
  const anaHintId = createHint.run(anaStepId, 'Dica da Ana').lastInsertRowid
  const biaHintId = createHint.run(biaStepId, 'Dica da Bia').lastInsertRowid

  assert.equal(repositories.puzzles.findByIdForAuthor(anaPuzzleId, anaId).id, anaPuzzleId)
  assert.equal(repositories.puzzles.findByIdForAuthor(anaPuzzleId, biaId), undefined)
  assert.throws(
    () => repositories.progress.create({ userId: anaId, puzzleId: anaPuzzleId, currentStepId: biaStepId }),
    /FOREIGN KEY/,
  )

  const progressId = repositories.progress.create({
    userId: anaId,
    puzzleId: anaPuzzleId,
    currentStepId: anaStepId,
  }).lastInsertRowid
  assert.throws(
    () => repositories.progress.addSolve({ userId: anaId, progressId, stepId: biaStepId }),
    RepositoryReferenceError,
  )
  assert.throws(
    () => repositories.progress.addHintReveal({ userId: anaId, progressId, hintId: biaHintId }),
    RepositoryReferenceError,
  )
  assert.throws(
    () => repositories.progress.addSolve({ userId: biaId, progressId, stepId: anaStepId }),
    RepositoryReferenceError,
  )

  repositories.progress.addSolve({ userId: anaId, progressId, stepId: anaStepId })
  repositories.progress.addHintReveal({ userId: anaId, progressId, hintId: anaHintId })
  assert.equal(database.prepare('SELECT count(*) AS count FROM step_solves').get().count, 1)
  assert.equal(database.prepare('SELECT count(*) AS count FROM hint_reveals').get().count, 1)

  assert.throws(
    () => repositories.progress.addSolve({ userId: anaId, progressId, stepId: anaStepId }),
    /UNIQUE/,
  )
  assert.throws(
    () => repositories.puzzles.create({ authorId: 999, nameDisplay: 'Sem autoria', nameKey: 'sem autoria' }),
    /FOREIGN KEY/,
  )
})
