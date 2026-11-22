import express from 'express'
import { validatePuzzleName } from './validation.js'

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

  return router
}
