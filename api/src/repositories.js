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
      create({ authorId, nameDisplay, nameKey }) {
        return insertPuzzle.run({ authorId, nameDisplay, nameKey })
      },
      findByIdForAuthor(puzzleId, authorId) {
        return findPuzzleByIdAndAuthor.get(puzzleId, authorId)
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
