import express from 'express'
import { ValidationError, validateAnswer, validateFinalMessage, validateHint, validateHintCount, validatePrompt, validatePuzzleName, validateStepCount } from './validation.js'
import { RepositoryReferenceError, VersionConflictError } from './repositories.js'

function sendError(response, status, code, message, fields) {
  response.status(status).json({ error: { code, message, fields } })
}

function atField(field, validate) {
  try {
    return validate()
  } catch (error) {
    if (error instanceof ValidationError) error.field = field
    throw error
  }
}

function readItems(items, field, validateCount, readItem) {
  if (!Array.isArray(items)) throw new ValidationError(field, 'Envie uma lista.')
  atField(field, () => validateCount(items.length))
  const seen = new Set()
  return items.map((item, index) => {
    const path = `${field}.${index}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(path, 'Envie um objeto.')
    }
    if (item.id !== undefined) {
      if (!Number.isSafeInteger(item.id) || item.id < 1 || seen.has(item.id)) {
        throw new ValidationError(path, 'O identificador deve ser positivo e único na lista.')
      }
      seen.add(item.id)
    }
    return readItem(item, path)
  })
}

function readDraftSteps(steps) {
  return readItems(steps, 'steps', validateStepCount, (step, path) => {
    const prompt = atField(`${path}.prompt`, () => validatePrompt(step.prompt ?? ''))
    const answer = atField(`${path}.answer`, () => validateAnswer(step.answer ?? '', { allowEmpty: true }))
    const hints = step.hints === undefined ? undefined : readItems(step.hints, `${path}.hints`, validateHintCount, (hint, hintPath) => ({
      id: hint.id,
      text: atField(`${hintPath}.text`, () => validateHint(hint.text)),
    }))
    return { id: step.id, prompt, answerText: answer.text, answerKey: answer.key, hints }
  })
}

export function createAuthorRouter({ repositories }) {
  const router = express.Router()

  function saveDraft(request, response, puzzleId) {
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }
    if (puzzleId && (!Number.isSafeInteger(body.version) || body.version < 1)) {
      sendError(response, 400, 'INVALID_VERSION', 'Informe a versão atual do rascunho.')
      return
    }

    try {
      const name = validatePuzzleName(body.name)
      const steps = readDraftSteps(body.steps === undefined && !puzzleId ? [] : body.steps)
      const finalMessage = body.finalMessage === undefined ? undefined : validateFinalMessage(body.finalMessage)
      const snapshot = { authorId: request.session.userId, nameDisplay: name.display, nameKey: name.key, finalMessage, steps }
      const puzzle = puzzleId
        ? repositories.puzzles.saveDraftSnapshot({ ...snapshot, puzzleId, expectedVersion: body.version })
        : repositories.puzzles.createDraftSnapshot(snapshot)
      response.status(puzzleId ? 200 : 201).json({ puzzle })
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(response, error.code === 'NAME_TAKEN' ? 409 : 400, error.code, error.message, { [error.field]: error.message })
      } else if (error instanceof RepositoryReferenceError) {
        sendError(response, 404, error.code, error.message)
      } else if (error instanceof VersionConflictError) {
        sendError(response, 409, error.code, error.message)
      } else {
        throw error
      }
    }
  }

  router.get('/puzzles', (request, response) => {
    const puzzles = repositories.puzzles.listForAuthor(request.session.userId)
      .map(({ id, name_display: name, status, version, updated_at: updatedAt }) => ({ id, name, status, version, updatedAt }))
    response.json({ puzzles })
  })

  router.post('/puzzles', (request, response) => {
    saveDraft(request, response)
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
    if (!Number.isSafeInteger(puzzleId) || puzzleId < 1) {
      sendError(response, 404, 'NOT_FOUND', 'Enigma não encontrado.')
      return
    }
    saveDraft(request, response, puzzleId)
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
        sendError(response, 400, error.code, error.message, error.fields)
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

  router.delete('/puzzles/:id', (request, response) => {
    const puzzleId = Number(request.params.id)
    const { confirmed, expectedVersion } = request.body ?? {}
    if (confirmed !== true) {
      sendError(response, 400, 'CONFIRMATION_REQUIRED', 'Confirme a exclusão do enigma e de todo o progresso associado.')
      return
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      sendError(response, 400, 'INVALID_VERSION', 'Informe a versão atual do enigma.')
      return
    }
    try {
      const deleted = repositories.puzzles.deleteForAuthor({ puzzleId, authorId: request.session.userId, expectedVersion })
      response.json({ deleted: true, puzzle: deleted })
    } catch (error) {
      if (error instanceof RepositoryReferenceError) sendError(response, 404, error.code, error.message)
      else if (error instanceof VersionConflictError) sendError(response, 409, error.code, error.message)
      else throw error
    }
  })

  return router
}
