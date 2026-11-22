import express from 'express'
import { validateAnswer, validateFinalMessage, validateHint, validatePrompt, validatePuzzleName, validateStepCount } from './validation.js'
import { RepositoryReferenceError, VersionConflictError } from './repositories.js'

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } })
}

export function createAuthorRouter({ repositories }) {
  const router = express.Router()

  router.get('/puzzles', (request, response) => {
    const puzzles = repositories.puzzles.listForAuthor(request.session.userId)
      .map(({ id, name_display: name, status, version, updated_at: updatedAt }) => ({ id, name, status, version, updatedAt }))
    response.json({ puzzles })
  })

  router.post('/puzzles', (request, response) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    let name
    try {
      name = validatePuzzleName(request.body.name)
    } catch (error) {
      if (error?.code !== 'INVALID_FIELD') throw error
      sendError(response, 400, error.code, error.message)
      return
    }

    try {
      const result = repositories.puzzles.create({ authorId: request.session.userId, nameDisplay: name.display, nameKey: name.key })
      response.status(201).json({ puzzle: repositories.puzzles.readForAuthor(result.lastInsertRowid, request.session.userId) })
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error
      sendError(response, 409, 'NAME_TAKEN', 'Já existe um enigma com esse nome.')
    }
  })

  router.get('/puzzles/:id', (request, response) => {
    const puzzleId = Number(request.params.id)
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1) {
      sendError(response, 404, 'NOT_FOUND', 'Enigma não encontrado.')
      return
    }

    const puzzle = repositories.puzzles.readForAuthor(puzzleId, request.session.userId)
    if (!puzzle) {
      sendError(response, 404, 'NOT_FOUND', 'Enigma não encontrado.')
      return
    }

    response.json({ puzzle })
  })

  router.put('/puzzles/:id/draft', (request, response) => {
    const puzzleId = Number(request.params.id)
    const body = request.body
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1 || !body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    try {
      const name = validatePuzzleName(body.name)
      validateStepCount(body.steps?.length)
      if (!Array.isArray(body.steps)) throw new Error('steps deve ser uma lista.')
      const seenIds = new Set()
      const steps = body.steps.map((step) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('Cada etapa deve ser um objeto.')
        if (step.id !== undefined && (!Number.isSafeInteger(step.id) || step.id < 1 || seenIds.has(step.id))) {
          throw new Error('IDs de etapa devem ser únicos e positivos.')
        }
        if (step.id !== undefined) seenIds.add(step.id)
        const prompt = validatePrompt(step.prompt ?? '')
        const answer = validateAnswer(step.answer ?? '', { allowEmpty: true })
        return { id: step.id, prompt, answerText: answer.text, answerKey: answer.key }
      })
      if (!Number.isSafeInteger(body.version) || body.version < 1) {
        sendError(response, 400, 'INVALID_VERSION', 'Informe a versão atual do rascunho.')
        return
      }
      const puzzle = repositories.puzzles.saveDraftSnapshot({
        puzzleId, authorId: request.session.userId, expectedVersion: body.version,
        nameDisplay: name.display, nameKey: name.key, steps,
      })
      response.json({ puzzle })
    } catch (error) {
      if (error?.code === 'INVALID_FIELD' || error instanceof Error && !error.code) {
        sendError(response, 400, 'INVALID_FIELD', error.message)
      } else if (error instanceof RepositoryReferenceError) {
        sendError(response, 404, error.code, error.message)
      } else if (error instanceof VersionConflictError) {
        sendError(response, 409, error.code, error.message)
      } else if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        sendError(response, 409, 'NAME_TAKEN', 'Já existe um enigma com esse nome.')
      } else {
        throw error
      }
    }
  })

  router.post('/puzzles/:id/publish', (request, response) => {
    const puzzleId = Number(request.params.id)
    const expectedVersion = request.body?.expectedVersion
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      sendError(response, 400, 'INVALID_VERSION', 'Informe o ID e a versão atual do rascunho.')
      return
    }

    try {
      const puzzle = repositories.puzzles.publish({ puzzleId, authorId: request.session.userId, expectedVersion })
      response.json({ puzzle })
    } catch (error) {
      if (error instanceof RepositoryReferenceError) {
        sendError(response, 404, error.code, error.message)
      } else if (error instanceof VersionConflictError) {
        sendError(response, 409, error.code, error.message)
      } else if (error.code === 'DRAFT_INCOMPLETE') {
        sendError(response, 400, error.code, error.message)
      } else {
        throw error
      }
    }
  })

  router.patch('/puzzles/:id/final-message', (request, response) => {
    const puzzleId = Number(request.params.id)
    try {
      const finalMessage = validateFinalMessage(request.body?.finalMessage)
      const expectedVersion = request.body?.expectedVersion
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Informe a versão atual.')
      const puzzle = repositories.puzzles.updateFinalMessage({ puzzleId, authorId: request.session.userId, expectedVersion, finalMessage })
      response.json({ puzzle })
    } catch (error) {
      if (error?.code === 'INVALID_FIELD' || !error.code) sendError(response, 400, 'INVALID_FIELD', error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  router.patch('/steps/:stepId/content', (request, response) => {
    const stepId = Number(request.params.stepId)
    try {
      const prompt = validatePrompt(request.body?.prompt)
      const answer = validateAnswer(request.body?.answer, { allowEmpty: false })
      const expectedVersion = request.body?.expectedVersion
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Informe a versão atual.')
      const puzzle = repositories.puzzles.updateStepContent({ stepId, authorId: request.session.userId, expectedVersion, prompt, answerText: answer.text, answerKey: answer.key })
      response.json({ puzzle })
    } catch (error) {
      if (error?.code === 'INVALID_FIELD' || !error.code) sendError(response, 400, 'INVALID_FIELD', error.message)
      else if (error instanceof RepositoryReferenceError) sendError(response, 404, error.code, error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  router.post('/steps/:stepId/hints', (request, response) => {
    const stepId = Number(request.params.stepId)
    try {
      const text = validateHint(request.body?.text)
      const expectedVersion = request.body?.expectedVersion
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Informe a versão atual.')
      response.status(201).json({ hints: repositories.puzzles.addHint({ stepId, authorId: request.session.userId, expectedVersion, text }) })
    } catch (error) {
      if (error?.code === 'INVALID_FIELD' || !error.code) sendError(response, 400, 'INVALID_FIELD', error.message)
      else if (error instanceof RepositoryReferenceError) sendError(response, 404, error.code, error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  router.patch('/hints/:hintId', (request, response) => {
    const hintId = Number(request.params.hintId)
    try {
      const text = validateHint(request.body?.text)
      const expectedVersion = request.body?.expectedVersion
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Informe a versão atual.')
      response.json({ hints: repositories.puzzles.editHint({ hintId, authorId: request.session.userId, expectedVersion, text }) })
    } catch (error) {
      if (error?.code === 'INVALID_FIELD' || !error.code) sendError(response, 400, 'INVALID_FIELD', error.message)
      else if (error instanceof RepositoryReferenceError) sendError(response, 404, error.code, error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  router.delete('/hints/:hintId', (request, response) => {
    const hintId = Number(request.params.hintId)
    try {
      const expectedVersion = Number(request.get('if-match'))
      response.json({ hints: repositories.puzzles.removeHint({ hintId, authorId: request.session.userId, expectedVersion }) })
    } catch (error) {
      if (error instanceof RepositoryReferenceError) sendError(response, 404, error.code, error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  return router
}
