import { timingSafeEqual } from 'node:crypto'

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function createRequestSecurity({ appOrigin }) {
  return function protectMutation(request, response, next) {
    if (!mutationMethods.has(request.method)) {
      next()
      return
    }

    const allowedOrigin = typeof appOrigin === 'function' ? appOrigin() : appOrigin
    if (request.get('origin') !== allowedOrigin) {
      response.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Origem não permitida.' } })
      return
    }

    const submittedToken = request.get('x-csrf-token')
    const sessionToken = request.session?.csrfToken
    if (typeof submittedToken !== 'string' || typeof sessionToken !== 'string' ||
        submittedToken.length !== sessionToken.length ||
        !timingSafeEqual(Buffer.from(submittedToken), Buffer.from(sessionToken))) {
      response.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Token de segurança ausente ou inválido.' } })
      return
    }

    next()
  }
}

export function requireAuthenticatedSession(request, response, next) {
  if (!request.session?.userId) {
    response.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Entre na sua conta para continuar.' } })
    return
  }

  next()
}
