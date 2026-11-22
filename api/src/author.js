import express from 'express'
import { validateAnswer, validatePrompt, validatePuzzleName, validateStepCount } from './validation.js'
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

  return router
}
