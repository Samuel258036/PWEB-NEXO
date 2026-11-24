import express from 'express'
import { validatePuzzleName } from './validation.js'

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } })
}

export function createPlayRouter({ repositories }) {
  const router = express.Router()

  router.post('/puzzles/open', (request, response) => {
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

    const play = repositories.progress.openPublishedByName({
      userId: request.session.userId,
      nameKey: name.key,
    })

    if (!play) {
      sendError(response, 404, 'PUZZLE_UNAVAILABLE', 'Enigma não encontrado ou indisponível.')
      return
    }

    response.json({ play })
  })

  return router
}