import { randomBytes } from 'node:crypto'
import express from 'express'
import { hashPassword, PasswordHashQueueFullError, verifyPassword } from './passwords.js'
import { ValidationError, validatePassword, validateUsername } from './validation.js'

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } })
}

function isRequestBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
}

function createCsrfToken() {
  return randomBytes(32).toString('hex')
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function setAuthenticatedSession(request, userId) {
  await regenerateSession(request)
  request.session.userId = userId
  request.session.csrfToken = createCsrfToken()
  await saveSession(request)
  return request.session.csrfToken
}

function sendValidationError(response, error) {
  if (!(error instanceof ValidationError)) {
    return false
  }

  sendError(response, 400, error.code, error.message)
  return true
}

function sendHashQueueError(response, error) {
  if (!(error instanceof PasswordHashQueueFullError)) {
    return false
  }

  sendError(response, 503, error.code, 'A autenticação está temporariamente ocupada. Tente novamente.')
  return true
}

function sendNameConflict(response) {
  sendError(response, 409, 'NAME_TAKEN', 'Esse nome já está em uso. Escolha outro ou entre na conta existente.')
}

function sendAuthenticationFailure(response) {
  sendError(response, 401, 'AUTHENTICATION_FAILED', 'Nome ou senha incorretos.')
}

export function createAuthRouter({ repositories }) {
  const router = express.Router()

  router.get('/session', (request, response) => {
    if (!request.session.csrfToken) {
      request.session.csrfToken = createCsrfToken()
    }

    const account = request.session.userId
      ? repositories.users.findById(request.session.userId)
      : null
    const user = account
      ? { id: account.id, usernameDisplay: account.username_display }
      : null

    response.json({ user, csrfToken: request.session.csrfToken })
  })

  router.post('/identify', (request, response) => {
    if (!isRequestBody(request.body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    let username
    try {
      username = validateUsername(request.body.username)
    } catch (error) {
      if (!sendValidationError(response, error)) {
        throw error
      }
      return
    }

    const account = repositories.users.findByUsernameKey(username.key)
    response.json({ state: account ? 'existing' : 'new' })
  })

  router.post('/register', async (request, response) => {
    if (!isRequestBody(request.body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    if (request.body.confirmedNew !== true) {
      sendError(response, 400, 'CONFIRMATION_REQUIRED', 'Confirme o cadastro antes de enviar a senha.')
      return
    }

    let username
    try {
      username = validateUsername(request.body.username)
      validatePassword(request.body.password)
    } catch (error) {
      if (!sendValidationError(response, error)) {
        throw error
      }
      return
    }

    if (repositories.users.findByUsernameKey(username.key)) {
      sendNameConflict(response)
      return
    }

    let passwordHash
    try {
      passwordHash = await hashPassword(request.body.password)
    } catch (error) {
      if (sendValidationError(response, error) || sendHashQueueError(response, error)) {
        return
      }
      throw error
    }

    let userId
    try {
      const result = repositories.users.create({
        usernameDisplay: username.display,
        usernameKey: username.key,
        passwordHash,
      })
      userId = result.lastInsertRowid
    } catch (error) {
      if (repositories.users.findByUsernameKey(username.key)) {
        sendNameConflict(response)
        return
      }
      throw error
    }

    const csrfToken = await setAuthenticatedSession(request, userId)
    response.status(201).json({
      user: { id: userId, usernameDisplay: username.display },
      csrfToken,
    })
  })

  router.post('/login', async (request, response) => {
    if (!isRequestBody(request.body)) {
      sendError(response, 400, 'INVALID_BODY', 'Envie um objeto JSON válido.')
      return
    }

    let username
    try {
      username = validateUsername(request.body.username)
    } catch (error) {
      if (!sendValidationError(response, error)) {
        throw error
      }
      return
    }

    const account = repositories.users.findByUsernameKey(username.key)
    if (!account) {
      sendAuthenticationFailure(response)
      return
    }

    let passwordMatches
    try {
      passwordMatches = await verifyPassword(request.body.password, account.password_hash)
    } catch (error) {
      if (sendHashQueueError(response, error)) {
        return
      }
      throw error
    }

    if (!passwordMatches) {
      sendAuthenticationFailure(response)
      return
    }

    const csrfToken = await setAuthenticatedSession(request, account.id)
    response.json({
      user: { id: account.id, usernameDisplay: account.username_display },
      csrfToken,
    })
  })

  return router
}
