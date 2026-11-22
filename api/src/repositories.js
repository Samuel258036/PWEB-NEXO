export class RepositoryReferenceError extends Error {
  constructor(action) {
    super(`Não foi possível ${action}: o recurso não existe ou não pertence à conta/enigma informado.`)
    this.name = 'RepositoryReferenceError'
    this.code = 'INVALID_REFERENCE'
  }
}

export class VersionConflictError extends Error {
  constructor() {
    super('O recurso foi alterado desde a última leitura. Recarregue e tente novamente.')
    this.name = 'VersionConflictError'
    this.code = 'VERSION_CONFLICT'
  }
}

function insertRelatedResource(statement, values, action) {
  const result = statement.run(values)

  if (result.changes === 0) {
    throw new RepositoryReferenceError(action)
  }

  return result
}

function incrementVersion(statement, values) {
  const result = statement.run(values)

  if (result.changes !== 1) {
    throw new VersionConflictError()
  }

  return result
}

export function createRepositories(database) {
  const findUserByUsernameKey = database.prepare(`
    SELECT id, username_display, username_key, password_hash, created_at
    FROM users
    WHERE username_key = ?
  `)
  const findUserById = database.prepare(`
    SELECT id, username_display, username_key, password_hash, created_at
    FROM users
    WHERE id = ?
  `)
  const insertUser = database.prepare(`
    INSERT INTO users (username_display, username_key, password_hash)
    VALUES (@usernameDisplay, @usernameKey, @passwordHash)
  `)

  const insertPuzzle = database.prepare(`
    INSERT INTO puzzles (author_id, name_display, name_key)
    VALUES (@authorId, @nameDisplay, @nameKey)
  `)
  const findPuzzleByIdAndAuthor = database.prepare(`
    SELECT id, author_id, name_display, name_key, status, final_message, version,
           created_at, updated_at, published_at
    FROM puzzles
    WHERE id = ? AND author_id = ?
  `)
  const listPuzzlesByAuthor = database.prepare(`
    SELECT id, author_id, name_display, name_key, status, final_message, version,
           created_at, updated_at, published_at
    FROM puzzles WHERE author_id = ? ORDER BY updated_at DESC, id DESC
  `)
  const findPuzzleByIdAndAuthorForRead = findPuzzleByIdAndAuthor
  const findStepsByPuzzleAndAuthor = database.prepare(`
    SELECT steps.id, steps.position, steps.prompt, steps.answer_text, steps.answer_key,
           steps.first_solved_at
    FROM steps JOIN puzzles ON puzzles.id = steps.puzzle_id
    WHERE steps.puzzle_id = ? AND puzzles.author_id = ? ORDER BY steps.position
  `)
  const findDraftForSave = database.prepare(`SELECT id, version, status FROM puzzles WHERE id = ? AND author_id = ?`)
  const findOwnedStep = database.prepare(`SELECT id FROM steps WHERE id = ? AND puzzle_id = ?`)
  const shiftStepPosition = database.prepare('UPDATE steps SET position = ? WHERE id = ? AND puzzle_id = ?')
  const insertDraftStep = database.prepare(`INSERT INTO steps (puzzle_id, position, prompt, answer_text, answer_key) VALUES (?, ?, ?, ?, ?)`)
  const updateDraftStep = database.prepare(`UPDATE steps SET position = ?, prompt = ?, answer_text = ?, answer_key = ? WHERE id = ? AND puzzle_id = ?`)
  const deleteUnlistedDraftSteps = database.prepare(`DELETE FROM steps WHERE puzzle_id = ? AND id NOT IN (SELECT value FROM json_each(?))`)
  const updateDraftSnapshot = database.prepare(`UPDATE puzzles SET name_display = ?, name_key = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'draft' AND version = ?`)
  const readDraftForPublish = database.prepare(`SELECT puzzles.id, puzzles.version, puzzles.status, puzzles.final_message, COUNT(steps.id) AS step_count, SUM(CASE WHEN trim(steps.prompt) = '' OR trim(steps.answer_text) = '' THEN 1 ELSE 0 END) AS incomplete_steps FROM puzzles LEFT JOIN steps ON steps.puzzle_id = puzzles.id WHERE puzzles.id = ? AND puzzles.author_id = ? GROUP BY puzzles.id`)
  const publishDraft = database.prepare(`UPDATE puzzles SET status = 'published', published_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'draft' AND version = ?`)
  const incrementPuzzleVersion = database.prepare(`
    UPDATE puzzles
    SET version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @puzzleId
      AND author_id = @authorId
      AND version = @expectedVersion
  `)

  const insertProgress = database.prepare(`
    INSERT INTO progress (user_id, puzzle_id, current_step_id)
    VALUES (@userId, @puzzleId, @currentStepId)
  `)
  const findProgressByUserAndPuzzle = database.prepare(`
    SELECT id, user_id, puzzle_id, current_step_id, completed_at, version,
           created_at, updated_at
    FROM progress
    WHERE user_id = ? AND puzzle_id = ?
  `)
  const incrementProgressVersion = database.prepare(`
    UPDATE progress
    SET version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @progressId
      AND user_id = @userId
      AND version = @expectedVersion
  `)
  const insertStepSolve = database.prepare(`
    INSERT INTO step_solves (progress_id, step_id)
    SELECT progress.id, steps.id
    FROM progress
    JOIN steps ON steps.puzzle_id = progress.puzzle_id
    WHERE progress.id = @progressId
      AND progress.user_id = @userId
      AND steps.id = @stepId
  `)
  const insertHintReveal = database.prepare(`
    INSERT INTO hint_reveals (progress_id, hint_id)
    SELECT progress.id, hints.id
    FROM progress
    JOIN steps ON steps.puzzle_id = progress.puzzle_id
    JOIN hints ON hints.step_id = steps.id
    WHERE progress.id = @progressId
      AND progress.user_id = @userId
      AND hints.id = @hintId
  `)

  return {
    users: {
      findById(userId) {
        return findUserById.get(userId)
      },
      findByUsernameKey(usernameKey) {
        return findUserByUsernameKey.get(usernameKey)
      },
      create({ usernameDisplay, usernameKey, passwordHash }) {
        return insertUser.run({ usernameDisplay, usernameKey, passwordHash })
      },
    },
    puzzles: {
      listForAuthor(authorId) {
        return listPuzzlesByAuthor.all(authorId)
      },
      create({ authorId, nameDisplay, nameKey }) {
        return insertPuzzle.run({ authorId, nameDisplay, nameKey })
      },
      findByIdForAuthor(puzzleId, authorId) {
        return findPuzzleByIdAndAuthor.get(puzzleId, authorId)
      },
      readForAuthor(puzzleId, authorId) {
        const puzzle = findPuzzleByIdAndAuthorForRead.get(puzzleId, authorId)
        if (!puzzle) return null
        return { ...puzzle, steps: findStepsByPuzzleAndAuthor.all(puzzleId, authorId) }
      },
      saveDraftSnapshot({ puzzleId, authorId, expectedVersion, nameDisplay, nameKey, steps }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = findDraftForSave.get(puzzleId, authorId)
          if (!puzzle) throw new RepositoryReferenceError('salvar o rascunho')
          if (puzzle.status !== 'draft') throw new RepositoryReferenceError('alterar um enigma publicado')
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()

          const positions = steps.map((step) => step.id).filter(Boolean)
          for (const stepId of positions) {
            if (!findOwnedStep.get(stepId, puzzleId)) throw new RepositoryReferenceError('alterar uma etapa')
          }
          for (const stepId of positions) shiftStepPosition.run(1000 + stepId, stepId, puzzleId)
          const savedIds = []
          steps.forEach((step, index) => {
            const position = index + 1
            if (step.id) {
              updateDraftStep.run(position, step.prompt, step.answerText, step.answerKey, step.id, puzzleId)
              savedIds.push(step.id)
            } else {
              const result = insertDraftStep.run(puzzleId, position, step.prompt, step.answerText, step.answerKey)
              savedIds.push(Number(result.lastInsertRowid))
            }
          })
          deleteUnlistedDraftSteps.run(puzzleId, JSON.stringify(savedIds))
          const changed = updateDraftSnapshot.run(nameDisplay, nameKey, puzzleId, authorId, expectedVersion)
          if (changed.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(puzzleId, authorId)
        })
      },
      publish({ puzzleId, authorId, expectedVersion }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = readDraftForPublish.get(puzzleId, authorId)
          if (!puzzle) throw new RepositoryReferenceError('publicar o enigma')
          if (puzzle.status !== 'draft') throw new RepositoryReferenceError('publicar um rascunho')
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          if (puzzle.step_count < 1 || puzzle.incomplete_steps > 0) {
            const error = new Error('Adicione ao menos uma etapa completa antes de publicar.')
            error.code = 'DRAFT_INCOMPLETE'
            throw error
          }
          const result = publishDraft.run(puzzleId, authorId, expectedVersion)
          if (result.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(puzzleId, authorId)
        })
      },
      incrementVersion({ puzzleId, authorId, expectedVersion }) {
        return incrementVersion(incrementPuzzleVersion, { puzzleId, authorId, expectedVersion })
      },
    },
    progress: {
      create({ userId, puzzleId, currentStepId }) {
        return insertProgress.run({ userId, puzzleId, currentStepId })
      },
      findByUserAndPuzzle(userId, puzzleId) {
        return findProgressByUserAndPuzzle.get(userId, puzzleId)
      },
      incrementVersion({ progressId, userId, expectedVersion }) {
        return incrementVersion(incrementProgressVersion, { progressId, userId, expectedVersion })
      },
      addSolve({ userId, progressId, stepId }) {
        return insertRelatedResource(insertStepSolve, { userId, progressId, stepId }, 'registrar a solução')
      },
      addHintReveal({ userId, progressId, hintId }) {
        return insertRelatedResource(insertHintReveal, { userId, progressId, hintId }, 'revelar a dica')
      },
    },
  }
}
import { runInImmediateTransaction } from './transactions.js'
