import express from 'express'
import { join } from 'node:path'

export function createApp({ buildDirectory } = {}) {
  const app = express()
  app.disable('x-powered-by')

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
