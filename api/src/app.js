import express from 'express'
import { join } from 'node:path'
import { createRepositories } from './repositories.js'
import { createAuthRouter } from './auth.js'
import { createSessionMiddleware } from './session-store.js'

export function createApp({
  buildDirectory,
  database,
  sessionSecret,
  secureCookie = false,
  trustProxyHops = 0,
} = {}) {
  const app = express()
  app.disable('x-powered-by')

  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops)
  }

  if (database) {
    const { middleware, store } = createSessionMiddleware({
      database,
      secret: sessionSecret,
      secure: secureCookie,
    })
    app.use(middleware)
    app.locals.sessionStore = store
    app.use('/api/auth', express.json(), createAuthRouter({ repositories: createRepositories(database) }))
  }

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' })
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
