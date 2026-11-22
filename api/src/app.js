import express from 'express'
import { join } from 'node:path'
import { createRepositories } from './repositories.js'
import { createAuthRouter } from './auth.js'
import { createSessionMiddleware } from './session-store.js'
import { createRequestSecurity, requireAuthenticatedSession } from './security.js'
import helmet from 'helmet'

function createAuthRateLimit({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
  const requestsByIp = new Map()
  return (request, response, next) => {
    const time = now()
    const key = request.ip
    const current = requestsByIp.get(key)
    if (!current || current.startedAt + windowMs <= time) {
      requestsByIp.set(key, { startedAt: time, count: 1 })
      next()
      return
    }
    current.count += 1
    if (current.count > limit) {
      const retryAfter = Math.ceil((current.startedAt + windowMs - time) / 1000)
      response.set('Retry-After', String(retryAfter))
      response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente em breve.' } })
      return
    }
    next()
  }
}

export function createApp({
  buildDirectory,
  database,
  sessionSecret,
  secureCookie = false,
  trustProxyHops = 0,
  appOrigin = 'http://localhost:5173',
} = {}) {
  const app = express()
  app.disable('x-powered-by')

  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops)
  }

  app.use(helmet())

  if (database) {
    const { middleware, store } = createSessionMiddleware({
      database,
      secret: sessionSecret,
      secure: secureCookie,
    })
    app.use(middleware)
    app.locals.sessionStore = store
    app.locals.appOrigin = appOrigin
    app.use('/api', express.json({ limit: '2mb' }))
    app.use('/api', createRequestSecurity({ appOrigin: () => app.locals.appOrigin }))
    const authRateLimit = createAuthRateLimit()
    app.use('/api/auth/identify', authRateLimit)
    app.use('/api/auth/register', authRateLimit)
    app.use('/api/auth/login', authRateLimit)
    app.use('/api/auth', createAuthRouter({ repositories: createRepositories(database) }))
    app.use('/api/author', requireAuthenticatedSession)
    app.use('/api/play', requireAuthenticatedSession)
  }

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' })
  })

  app.use((error, _request, response, next) => {
    if (error?.type === 'entity.too.large') {
      response.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'O conteúdo excede o limite de 2 MiB.' } })
      return
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Envie um JSON válido.' } })
      return
    }
    next(error)
  })

  if (buildDirectory) {
    app.use(express.static(buildDirectory, { index: false }))
    app.get('/{*path}', (request, response, next) => {
      response.vary('Accept')

      if (!request.accepts().includes('text/html')) {
        return next()
      }

      response.sendFile(join(buildDirectory, 'index.html'))
    })
  }

  return app
}
