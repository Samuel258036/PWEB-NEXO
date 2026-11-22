import session from 'express-session'

const sessionLifetime = 7 * 24 * 60 * 60 * 1000

function getExpiration(sessionData, now) {
  const cookie = sessionData.cookie ?? {}

  if (cookie.expires) {
    const expiresAt = new Date(cookie.expires).getTime()
    if (Number.isFinite(expiresAt)) {
      return expiresAt
    }
  }

  if (Number.isFinite(cookie.maxAge)) {
    return now() + cookie.maxAge
  }

  return now() + sessionLifetime
}

export class SqliteSessionStore extends session.Store {
  constructor(database, { cleanupInterval = 60 * 60 * 1000, now = Date.now } = {}) {
    super()
    this.now = now
    this.findSession = database.prepare('SELECT data, expires_at FROM sessions WHERE id = ?')
    this.saveSession = database.prepare(`
      INSERT INTO sessions (id, data, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        data = excluded.data,
        expires_at = excluded.expires_at
    `)
    this.updateExpiration = database.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    this.deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?')
    this.deleteExpired = database.prepare('DELETE FROM sessions WHERE expires_at <= ?')

    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupExpired()
      } catch {
        // A cleanup failure must not stop the server; normal store operations still report errors.
      }
    }, cleanupInterval)
    this.cleanupTimer.unref()
  }

  get(sessionId, callback) {
    try {
      const row = this.findSession.get(sessionId)
      if (!row) {
        callback(null, null)
        return
      }

      if (row.expires_at <= this.now()) {
        this.deleteSession.run(sessionId)
        callback(null, null)
        return
      }

      callback(null, JSON.parse(row.data))
    } catch (error) {
      callback(error)
    }
  }

  set(sessionId, sessionData, callback) {
    try {
      const expiresAt = getExpiration(sessionData, this.now)
      this.saveSession.run(sessionId, JSON.stringify(sessionData), expiresAt)
      callback?.(null)
    } catch (error) {
      callback?.(error)
    }
  }

  destroy(sessionId, callback) {
    try {
      this.deleteSession.run(sessionId)
      callback?.(null)
    } catch (error) {
      callback?.(error)
    }
  }

  touch(sessionId, sessionData, callback) {
    try {
      const expiresAt = getExpiration(sessionData, this.now)
      this.updateExpiration.run(expiresAt, sessionId)
      callback?.(null)
    } catch (error) {
      callback?.(error)
    }
  }

  cleanupExpired() {
    return this.deleteExpired.run(this.now()).changes
  }

  close() {
    clearInterval(this.cleanupTimer)
  }
}

export function createSessionMiddleware({ database, secret, secure = false }) {
  if (!database || !secret) {
    throw new TypeError('O banco e o segredo de sessão são obrigatórios.')
  }

  const store = new SqliteSessionStore(database)
  const middleware = session({
    store,
    secret,
    name: 'nexo.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: sessionLifetime,
    },
  })

  return { middleware, store }
}
