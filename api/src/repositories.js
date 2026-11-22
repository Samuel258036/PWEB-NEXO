export class RepositoryReferenceError extends Error {
  constructor(action) {
    super(`Não foi possível ${action}: o recurso não existe ou não pertence à conta/enigma informado.`)
    this.name = 'RepositoryReferenceError'
    this.code = 'INVALID_REFERENCE'
  }
}

function insertRelatedResource(statement, values, action) {
  const result = statement.run(values)

  if (result.changes === 0) {
    throw new RepositoryReferenceError(action)
  }

  return result
}

export function createRepositories(database) {
  const findUserByUsernameKey = database.prepare(`
    SELECT id, username_display, username_key, password_hash, created_at
    FROM users
    WHERE username_key = ?
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
      findByUsernameKey(usernameKey) {
        return findUserByUsernameKey.get(usernameKey)
      },
      create({ usernameDisplay, usernameKey, passwordHash }) {
        return insertUser.run({ usernameDisplay, usernameKey, passwordHash })
      },
    },
    puzzles: {
      create({ authorId, nameDisplay, nameKey }) {
        return insertPuzzle.run({ authorId, nameDisplay, nameKey })
      },
      findByIdForAuthor(puzzleId, authorId) {
        return findPuzzleByIdAndAuthor.get(puzzleId, authorId)
      },
    },
    progress: {
      create({ userId, puzzleId, currentStepId }) {
        return insertProgress.run({ userId, puzzleId, currentStepId })
      },
      findByUserAndPuzzle(userId, puzzleId) {
        return findProgressByUserAndPuzzle.get(userId, puzzleId)
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
