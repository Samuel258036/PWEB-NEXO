import { runInImmediateTransaction } from './transactions.js'
import { ValidationError, validateHintCount } from './validation.js'

export class StaleProgressError extends Error {
  constructor(play = null) {
    super('O progresso da partida mudou desde a última leitura. Recarregue a etapa atual e tente novamente.')
    this.name = 'StaleProgressError'
    this.code = 'STALE_PROGRESS'
    this.play = play
  }
}

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

  const findProgressForHintReveal = database.prepare(`
    SELECT
      progress.id AS progress_id,
      progress.user_id,
      progress.puzzle_id,
      progress.current_step_id,
      progress.completed_at,
      progress.version
    FROM progress
    JOIN puzzles ON puzzles.id = progress.puzzle_id
    WHERE progress.user_id = ?
      AND progress.puzzle_id = ?
      AND puzzles.status = 'published'
  `)
  const findNextUnrevealedHintForStep = database.prepare(`
    SELECT hints.id, hints.step_id, hints.position, hints.text
    FROM hints
    WHERE hints.step_id = ?
      AND hints.id NOT IN (
        SELECT hint_id
        FROM hint_reveals
        WHERE progress_id = ?
      )
    ORDER BY hints.position ASC
    LIMIT 1
  `)
  const findHintForCurrentStep = database.prepare(`
    SELECT hints.id, hints.step_id, hints.position, hints.text
    FROM hints
    WHERE hints.id = ? AND hints.step_id = ?
  `)
  const isHintAlreadyRevealed = database.prepare(`
    SELECT 1
    FROM hint_reveals
    WHERE progress_id = ? AND hint_id = ?
  `)
  const insertHintRevealIgnoreDuplicate = database.prepare(`
    INSERT OR IGNORE INTO hint_reveals (progress_id, hint_id)
    VALUES (?, ?)
  `)
  
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
    INSERT INTO puzzles (author_id, name_display, name_key, final_message)
    VALUES (@authorId, @nameDisplay, @nameKey, @finalMessage)
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
  const findPuzzleIdByNameKey = database.prepare('SELECT id FROM puzzles WHERE name_key = ?')
  const findPublishedPuzzleByNameKey = database.prepare(`
    SELECT id, author_id, name_display, name_key, status, final_message, version,
           created_at, updated_at, published_at
    FROM puzzles
    WHERE name_key = ? AND status = 'published'
  `)
  const findStepsByPuzzleAndAuthor = database.prepare(`
    SELECT steps.id, steps.position, steps.prompt, steps.answer_text, steps.answer_key,
           steps.first_solved_at
    FROM steps JOIN puzzles ON puzzles.id = steps.puzzle_id
    WHERE steps.puzzle_id = ? AND puzzles.author_id = ? ORDER BY steps.position
  `)
  const findHintsByStep = database.prepare(`SELECT id, position, text FROM hints WHERE step_id = ? ORDER BY position`)
  const findDraftForSave = database.prepare(`SELECT id, version, status FROM puzzles WHERE id = ? AND author_id = ?`)
  const findOwnedStep = database.prepare(`SELECT id FROM steps WHERE id = ? AND puzzle_id = ?`)
  const shiftStepPosition = database.prepare('UPDATE steps SET position = ? WHERE id = ? AND puzzle_id = ?')
  const insertDraftStep = database.prepare(`INSERT INTO steps (puzzle_id, position, prompt, answer_text, answer_key) VALUES (?, ?, ?, ?, ?)`)
  const updateDraftStep = database.prepare(`UPDATE steps SET position = ?, prompt = ?, answer_text = ?, answer_key = ? WHERE id = ? AND puzzle_id = ?`)
  const deleteUnlistedDraftSteps = database.prepare(`DELETE FROM steps WHERE puzzle_id = ? AND id NOT IN (SELECT value FROM json_each(?))`)
  const updateDraftSnapshot = database.prepare(`UPDATE puzzles SET name_display = ?, name_key = ?, final_message = COALESCE(?, final_message), version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'draft' AND version = ?`)
  const updateDraftHint = database.prepare('UPDATE hints SET text = ?, position = ? WHERE id = ?')
  const publishDraft = database.prepare(`UPDATE puzzles SET status = 'published', published_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'draft' AND version = ?`)
  const updateFinalMessage = database.prepare(`UPDATE puzzles SET final_message = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'published' AND version = ?`)
  const findStepForAuthor = database.prepare(`SELECT steps.id, steps.puzzle_id, steps.first_solved_at FROM steps JOIN puzzles ON puzzles.id = steps.puzzle_id WHERE steps.id = ? AND puzzles.author_id = ? AND puzzles.status = 'published'`)
  const updateStepContent = database.prepare(`UPDATE steps SET prompt = ?, answer_text = ?, answer_key = ? WHERE id = ? AND first_solved_at IS NULL`)
  const updateStepPrompt = database.prepare(`UPDATE steps SET prompt = ? WHERE id = ?`)
  const incrementOwnedPuzzleVersion = database.prepare(`UPDATE puzzles SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_id = ? AND status = 'published' AND version = ?`)
  const insertHint = database.prepare(`INSERT INTO hints (step_id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM hints WHERE step_id = ?`)
  const findHintForAuthor = database.prepare(`SELECT hints.id, hints.step_id, hints.position, steps.puzzle_id FROM hints JOIN steps ON steps.id = hints.step_id JOIN puzzles ON puzzles.id = steps.puzzle_id WHERE hints.id = ? AND puzzles.author_id = ? AND puzzles.status = 'published'`)
  const updateHintText = database.prepare(`UPDATE hints SET text = ? WHERE id = ?`)
  const deleteHint = database.prepare(`DELETE FROM hints WHERE id = ?`)
  const deleteOwnedPuzzle = database.prepare(`DELETE FROM puzzles WHERE id = ? AND author_id = ? AND version = ?`)
  const shiftHintsAfterDelete = database.prepare(`UPDATE hints SET position = position - 1 WHERE step_id = ? AND position > ?`)
  const listHintsForStep = database.prepare(`SELECT id, step_id, position, text FROM hints WHERE step_id = ? ORDER BY position`)
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
  const findFirstStepByPuzzle = database.prepare(`
    SELECT id, position, prompt
    FROM steps
    WHERE puzzle_id = ?
    ORDER BY position ASC
    LIMIT 1
  `)
  const findPlayStateByUserAndPuzzle = database.prepare(`
    SELECT
      progress.id AS progress_id,
      progress.user_id,
      progress.puzzle_id,
      progress.current_step_id,
      progress.completed_at,
      progress.version,
      puzzles.name_display,
      puzzles.final_message
    FROM progress
    JOIN puzzles ON puzzles.id = progress.puzzle_id
    WHERE progress.user_id = ?
      AND progress.puzzle_id = ?
      AND puzzles.status = 'published'
  `)
  const findPlayStepById = database.prepare(`
    SELECT id, position, prompt
    FROM steps
    WHERE id = ? AND puzzle_id = ?
  `)
  const findRevealedHintsForProgressStep = database.prepare(`
    SELECT hints.id, hints.position, hints.text
    FROM hint_reveals
    JOIN hints ON hints.id = hint_reveals.hint_id
    WHERE hint_reveals.progress_id = ? AND hints.step_id = ?
    ORDER BY hints.position ASC
  `)
  const countHintsForStep = database.prepare(`
    SELECT COUNT(*) AS total
    FROM hints
    WHERE step_id = ?
  `)

  const findProgressForSubmit = database.prepare(`
    SELECT
      progress.id AS progress_id,
      progress.user_id,
      progress.puzzle_id,
      progress.current_step_id,
      progress.completed_at,
      progress.version
    FROM progress
    JOIN puzzles ON puzzles.id = progress.puzzle_id
    WHERE progress.user_id = ?
      AND progress.puzzle_id = ?
      AND puzzles.status = 'published'
  `)
  const findStepForSubmit = database.prepare(`
    SELECT id, position, answer_key, first_solved_at
    FROM steps
    WHERE id = ? AND puzzle_id = ?
  `)
  const findNextStepByPosition = database.prepare(`
    SELECT id
    FROM steps
    WHERE puzzle_id = ? AND position > ?
    ORDER BY position ASC
    LIMIT 1
  `)
  const markStepFirstSolved = database.prepare(`
    UPDATE steps
    SET first_solved_at = CURRENT_TIMESTAMP
    WHERE id = ? AND first_solved_at IS NULL
  `)
  const incrementPuzzleVersionOnFirstSolve = database.prepare(`
    UPDATE puzzles SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `)
  const recordStepSolveIgnoreDuplicate = database.prepare(`
    INSERT OR IGNORE INTO step_solves (progress_id, step_id)
    VALUES (?, ?)
  `)
  const advanceProgressToNextStep = database.prepare(`
    UPDATE progress
    SET current_step_id = ?,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ?
  `)
  const completeProgressRecord = database.prepare(`
    UPDATE progress
    SET current_step_id = NULL,
        completed_at = CURRENT_TIMESTAMP,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ?
  `)

  function checkDraftName(nameKey, puzzleId) {
    const owner = findPuzzleIdByNameKey.get(nameKey)
    if (owner && owner.id !== puzzleId) {
      const error = new ValidationError('name', 'Já existe um enigma com esse nome.')
      error.code = 'NAME_TAKEN'
      throw error
    }
  }

  function writeDraftHints(stepId, hints, field) {
    const current = findHintsByStep.all(stepId)
    const retained = new Set()
    let previousPosition = 0
    for (const hint of hints) {
      if (hint.id === undefined) {
        previousPosition = Infinity
        continue
      }
      const saved = current.find((item) => item.id === hint.id)
      if (!saved) throw new RepositoryReferenceError('alterar uma dica')
      if (saved.position <= previousPosition) {
        throw new ValidationError(field, 'Mantenha a ordem das dicas existentes e acrescente novas ao final.')
      }
      retained.add(hint.id)
      previousPosition = saved.position
    }

    for (const hint of current) {
      if (!retained.has(hint.id)) deleteHint.run(hint.id)
    }
    hints.forEach((hint, index) => {
      if (hint.id === undefined) insertHint.run(stepId, hint.text, stepId)
      else updateDraftHint.run(hint.text, index + 1, hint.id)
    })
  }

  function writeDraftSteps(puzzleId, steps) {
    const retainedIds = steps.flatMap((step) => step.id === undefined ? [] : [step.id])
    for (const stepId of retainedIds) {
      if (!findOwnedStep.get(stepId, puzzleId)) throw new RepositoryReferenceError('alterar uma etapa')
    }
    deleteUnlistedDraftSteps.run(puzzleId, JSON.stringify(retainedIds))
    for (const stepId of retainedIds) shiftStepPosition.run(1000 + stepId, stepId, puzzleId)
    steps.forEach((step, index) => {
      const position = index + 1
      let stepId = step.id
      if (stepId === undefined) {
        stepId = Number(insertDraftStep.run(puzzleId, position, step.prompt, step.answerText, step.answerKey).lastInsertRowid)
      } else {
        updateDraftStep.run(position, step.prompt, step.answerText, step.answerKey, stepId, puzzleId)
      }
      if (step.hints !== undefined) writeDraftHints(stepId, step.hints, `steps.${index}.hints`)
    })
  }

  function buildPlayDto(userId, puzzleId) {
    const state = findPlayStateByUserAndPuzzle.get(userId, puzzleId)
    if (!state) return null

    if (state.completed_at !== null) {
      return {
        puzzle: {
          id: state.puzzle_id,
          name: state.name_display,
        },
        status: 'completed',
        version: state.version,
        currentStep: null,
        finalMessage: state.final_message ?? null,
      }
    }

    const step = findPlayStepById.get(state.current_step_id, state.puzzle_id)
    if (!step) return null

    const revealedHints = findRevealedHintsForProgressStep.all(state.progress_id, step.id)
    const { total: totalHints } = countHintsForStep.get(step.id)

    return {
      puzzle: {
        id: state.puzzle_id,
        name: state.name_display,
      },
      status: 'in_progress',
      version: state.version,
      currentStep: {
        id: step.id,
        position: step.position,
        prompt: step.prompt,
        revealedHints,
        hasMoreHints: totalHints > revealedHints.length,
      },
      finalMessage: null,
    }
  }

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
        return insertPuzzle.run({ authorId, nameDisplay, nameKey, finalMessage: null })
      },
      createDraftSnapshot({ authorId, nameDisplay, nameKey, finalMessage = null, steps }) {
        return runInImmediateTransaction(database, () => {
          checkDraftName(nameKey)
          const { lastInsertRowid } = insertPuzzle.run({ authorId, nameDisplay, nameKey, finalMessage })
          writeDraftSteps(Number(lastInsertRowid), steps)
          return this.readForAuthor(lastInsertRowid, authorId)
        })
      },
      findByIdForAuthor(puzzleId, authorId) {
        return findPuzzleByIdAndAuthor.get(puzzleId, authorId)
      },
      findPublishedByNameKey(nameKey) {
        return findPublishedPuzzleByNameKey.get(nameKey)
      },
      readForAuthor(puzzleId, authorId) {
        const puzzle = findPuzzleByIdAndAuthorForRead.get(puzzleId, authorId)
        if (!puzzle) return null
        const steps = findStepsByPuzzleAndAuthor.all(puzzleId, authorId).map((step) => ({
          ...step,
          hints: findHintsByStep.all(step.id),
        }))
        return { ...puzzle, steps }
      },
      saveDraftSnapshot({ puzzleId, authorId, expectedVersion, nameDisplay, nameKey, finalMessage = null, steps }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = findDraftForSave.get(puzzleId, authorId)
          if (!puzzle) throw new RepositoryReferenceError('salvar o rascunho')
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          if (puzzle.status !== 'draft') throw new RepositoryReferenceError('alterar um enigma publicado')

          checkDraftName(nameKey, puzzleId)
          writeDraftSteps(puzzleId, steps)
          const changed = updateDraftSnapshot.run(nameDisplay, nameKey, finalMessage, puzzleId, authorId, expectedVersion)
          if (changed.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(puzzleId, authorId)
        })
      },
      publish({ puzzleId, authorId, expectedVersion }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = this.readForAuthor(puzzleId, authorId)
          if (!puzzle) throw new RepositoryReferenceError('publicar o enigma')
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          if (puzzle.status !== 'draft') throw new RepositoryReferenceError('publicar um rascunho')
          const fields = {}
          if (puzzle.steps.length === 0) fields.steps = 'Adicione ao menos uma etapa.'
          puzzle.steps.forEach((step, index) => {
            if (!step.prompt.trim()) fields[`steps.${index}.prompt`] = 'Preencha o enunciado.'
            if (!step.answer_text.trim()) fields[`steps.${index}.answer`] = 'Preencha a resposta.'
          })
          if (Object.keys(fields).length > 0) {
            const error = new Error('Complete as etapas do rascunho antes de publicar.')
            error.code = 'DRAFT_INCOMPLETE'
            error.fields = fields
            throw error
          }
          const result = publishDraft.run(puzzleId, authorId, expectedVersion)
          if (result.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(puzzleId, authorId)
        })
      },
      updateFinalMessage({ puzzleId, authorId, expectedVersion, finalMessage }) {
        return runInImmediateTransaction(database, () => {
          const result = updateFinalMessage.run(finalMessage, puzzleId, authorId, expectedVersion)
          if (result.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(puzzleId, authorId)
        })
      },
      updateStepContent({ stepId, authorId, expectedVersion, prompt, answerText, answerKey }) {
        return runInImmediateTransaction(database, () => {
          const step = findStepForAuthor.get(stepId, authorId)
          if (!step) throw new RepositoryReferenceError('editar a etapa')
          const puzzle = findDraftForSave.get(step.puzzle_id, authorId)
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          if (step.first_solved_at) {
            updateStepPrompt.run(prompt, stepId)
          } else {
            updateStepContent.run(prompt, answerText, answerKey, stepId)
          }
          const result = incrementOwnedPuzzleVersion.run(step.puzzle_id, authorId, expectedVersion)
          if (result.changes !== 1) throw new VersionConflictError()
          return this.readForAuthor(step.puzzle_id, authorId)
        })
      },
      addHint({ stepId, authorId, expectedVersion, text }) {
        return runInImmediateTransaction(database, () => {
          const step = findStepForAuthor.get(stepId, authorId)
          if (!step) throw new RepositoryReferenceError('adicionar a dica')
          const puzzle = findDraftForSave.get(step.puzzle_id, authorId)
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          validateHintCount(findHintsByStep.all(stepId).length + 1)
          insertHint.run(stepId, text, stepId)
          if (incrementOwnedPuzzleVersion.run(step.puzzle_id, authorId, expectedVersion).changes !== 1) throw new VersionConflictError()
          return listHintsForStep.all(stepId)
        })
      },
      editHint({ hintId, authorId, expectedVersion, text }) {
        return runInImmediateTransaction(database, () => {
          const hint = findHintForAuthor.get(hintId, authorId)
          if (!hint) throw new RepositoryReferenceError('editar a dica')
          const puzzle = findDraftForSave.get(hint.puzzle_id, authorId)
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          updateHintText.run(text, hintId)
          if (incrementOwnedPuzzleVersion.run(hint.puzzle_id, authorId, expectedVersion).changes !== 1) throw new VersionConflictError()
          return listHintsForStep.all(hint.step_id)
        })
      },
      removeHint({ hintId, authorId, expectedVersion }) {
        return runInImmediateTransaction(database, () => {
          const hint = findHintForAuthor.get(hintId, authorId)
          if (!hint) throw new RepositoryReferenceError('remover a dica')
          const puzzle = findDraftForSave.get(hint.puzzle_id, authorId)
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          deleteHint.run(hintId)
          shiftHintsAfterDelete.run(hint.step_id, hint.position)
          if (incrementOwnedPuzzleVersion.run(hint.puzzle_id, authorId, expectedVersion).changes !== 1) throw new VersionConflictError()
          return listHintsForStep.all(hint.step_id)
        })
      },
      deleteForAuthor({ puzzleId, authorId, expectedVersion }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = findPuzzleByIdAndAuthor.get(puzzleId, authorId)
          if (!puzzle) throw new RepositoryReferenceError('excluir o enigma')
          if (puzzle.version !== expectedVersion) throw new VersionConflictError()
          const result = deleteOwnedPuzzle.run(puzzleId, authorId, expectedVersion)
          if (result.changes !== 1) throw new VersionConflictError()
          return { id: puzzleId, name: puzzle.name_display }
        })
      },
      incrementVersion({ puzzleId, authorId, expectedVersion }) {
        return incrementVersion(incrementPuzzleVersion, { puzzleId, authorId, expectedVersion })
      },
    },
    progress: {

      revealNextHint({ userId, puzzleId, stepId, expectedVersion, hintId }) {
        return runInImmediateTransaction(database, () => {
          const current = findProgressForHintReveal.get(userId, puzzleId)
          if (!current) return null

          if (
            current.completed_at !== null ||
            current.current_step_id === null ||
            current.current_step_id !== stepId ||
            current.version !== expectedVersion
          ) {
            throw new StaleProgressError(buildPlayDto(userId, puzzleId))
          }

          const nextHint = findNextUnrevealedHintForStep.get(stepId, current.progress_id)
          if (!nextHint) {
            return {
              exhausted: true,
              play: buildPlayDto(userId, puzzleId),
            }
          }

          if (hintId !== undefined) {
            const requestedHint = findHintForCurrentStep.get(hintId, stepId)
            if (!requestedHint) {
              throw new RepositoryReferenceError('revelar a dica')
            }

            if (isHintAlreadyRevealed.get(current.progress_id, requestedHint.id)) {
              return {
                exhausted: false,
                play: buildPlayDto(userId, puzzleId),
              }
            }

            if (requestedHint.id !== nextHint.id) {
              const error = new Error('As dicas desta etapa devem ser reveladas na ordem atual.')
              error.code = 'HINT_OUT_OF_ORDER'
              throw error
            }
          }

          insertHintRevealIgnoreDuplicate.run(current.progress_id, nextHint.id)

          const updated = incrementProgressVersion.run({
            progressId: current.progress_id,
            userId,
            expectedVersion,
          })
          if (updated.changes !== 1) {
            throw new StaleProgressError(buildPlayDto(userId, puzzleId))
          }

          return {
            exhausted: false,
            play: buildPlayDto(userId, puzzleId),
          }
        })
      },

      submitAnswer({ userId, puzzleId, stepId, expectedVersion, answerKey }) {
        return runInImmediateTransaction(database, () => {
          const current = findProgressForSubmit.get(userId, puzzleId)
          if (!current) return null

          if (
            current.completed_at !== null ||
            current.current_step_id === null ||
            current.current_step_id !== stepId ||
            current.version !== expectedVersion
          ) {
            throw new StaleProgressError(buildPlayDto(userId, puzzleId))
          }

          const step = findStepForSubmit.get(current.current_step_id, puzzleId)
          if (!step) return null

          if (step.answer_key !== answerKey) {
            return {
              correct: false,
              play: buildPlayDto(userId, puzzleId),
            }
          }

          if (step.first_solved_at === null) {
            markStepFirstSolved.run(step.id)
            incrementPuzzleVersionOnFirstSolve.run(puzzleId)
          }

          recordStepSolveIgnoreDuplicate.run(current.progress_id, step.id)

          const nextStep = findNextStepByPosition.get(puzzleId, step.position)
          if (nextStep) {
            const updated = advanceProgressToNextStep.run(
              nextStep.id,
              current.progress_id,
              userId,
              current.version,
            )
            if (updated.changes !== 1) {
              throw new StaleProgressError(buildPlayDto(userId, puzzleId))
            }
          } else {
            const completed = completeProgressRecord.run(
              current.progress_id,
              userId,
              current.version,
            )
            if (completed.changes !== 1) {
              throw new StaleProgressError(buildPlayDto(userId, puzzleId))
            }
          }

          return {
            correct: true,
            play: buildPlayDto(userId, puzzleId),
          }
        })
      },
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
      openPublishedByName({ userId, nameKey }) {
        return runInImmediateTransaction(database, () => {
          const puzzle = findPublishedPuzzleByNameKey.get(nameKey)
          if (!puzzle) return null

          const existing = findProgressByUserAndPuzzle.get(userId, puzzle.id)
          if (!existing) {
            const firstStep = findFirstStepByPuzzle.get(puzzle.id)
            if (!firstStep) return null

            insertProgress.run({
              userId,
              puzzleId: puzzle.id,
              currentStepId: firstStep.id,
            })
          }

          return buildPlayDto(userId, puzzle.id)
        })
      },
      readPlayState(userId, puzzleId) {
        return buildPlayDto(userId, puzzleId)
      },
    },
  }
}
