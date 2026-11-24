import express from 'express'
import { validateAnswer, validatePuzzleName } from './validation.js'
import { VersionConflictError } from './repositories.js'

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

  router.get('/puzzles/:id', (request, response) => {
    const puzzleId = Number(request.params.id)
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1) {
      sendError(response, 404, 'PUZZLE_UNAVAILABLE', 'Enigma não encontrado ou indisponível.')
      return
    }

    const play = repositories.progress.readPlayState(request.session.userId, puzzleId)
    if (!play) {
      sendError(response, 404, 'PUZZLE_UNAVAILABLE', 'Enigma não encontrado ou indisponível.')
      return
    }

    response.json({ play })
  })

  router.post('/puzzles/:id/answer', (request, response) => {
    const puzzleId = Number(request.params.id)
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1) {
      sendError(response, 404, 'PUZZLE_UNAVAILABLE', 'Enigma não encontrado ou indisponível.')
      return
    }

    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    let answer
    try {
      answer = validateAnswer(request.body.answer, { allowEmpty: false })
    } catch (error) {
      if (error?.code !== 'INVALID_FIELD') throw error
      sendError(response, 400, error.code, error.message)
      return
    }

    try {
      const result = repositories.progress.submitAnswer({
        userId: request.session.userId,
        puzzleId,
        answerKey: answer.key,
      })

      if (!result) {
        sendError(response, 404, 'PUZZLE_UNAVAILABLE', 'Enigma não encontrado ou indisponível.')
        return
      }

      response.json(result)
    } catch (error) {
      if (error?.code === 'PUZZLE_ALREADY_COMPLETED') {
        sendError(response, 409, error.code, error.message)
      } else if (error instanceof VersionConflictError) {
        sendError(response, 409, error.code, error.message)
      } else {
        throw error
      }
    }
  })

  return router
}