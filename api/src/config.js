import { mkdirSync, mkdtempSync, rmdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = fileURLToPath(new URL('../../', import.meta.url))

export function readConfig(env, defaultMode = 'development') {
  const mode = env.NODE_ENV ?? defaultMode
  if (!['development', 'test', 'production'].includes(mode)) {
    throw new Error('NODE_ENV deve ser development, test ou production.')
  }
  const production = mode === 'production'

  const rawPort = env.PORT ?? '3000'
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um inteiro de 1 a 65535.')
  }

  const rawOrigin = env.APP_ORIGIN ?? (production ? '' : 'http://localhost:5173')
  const origin = URL.parse(rawOrigin)
  if (!origin || !/^https?:\/\/[^/?#]+\/?$/i.test(rawOrigin) ||
      origin.username || origin.password || origin.pathname !== '/' ||
      rawOrigin.includes('\\') || rawOrigin.includes('@')) {
    throw new Error('APP_ORIGIN deve conter apenas uma origem HTTP ou HTTPS.')
  }
  if (production && origin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN deve usar HTTPS em produção.')
  }
  if (!production && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('APP_ORIGIN deve ser local em desenvolvimento e teste.')
  }

  const rawDatabasePath = env.DATABASE_PATH ?? (production ? '' : 'data/nexo.sqlite')
  if (!rawDatabasePath.trim() || rawDatabasePath.includes('\0') ||
      /[\\/]$/.test(rawDatabasePath) || (production && !isAbsolute(rawDatabasePath))) {
    throw new Error('DATABASE_PATH deve apontar para um arquivo e ser absoluto em produção.')
  }
  const databasePath = resolve(projectDirectory, rawDatabasePath)
  if (process.platform === 'win32') {
    const parts = databasePath.slice(parse(databasePath).root.length).split(sep)
    const invalidPart = /[<>:"|?*]|[. ]$|^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
    const hasInvalidPart = parts.some((part) => {
      const hasControlCharacter = [...part].some((character) => character.charCodeAt(0) < 32)
      return hasControlCharacter || invalidPart.test(part)
    })
    if (hasInvalidPart) {
      throw new Error('DATABASE_PATH contém um nome inválido no Windows.')
    }
  }

  const sessionSecret = env.SESSION_SECRET
  if (production && !sessionSecret?.trim()) {
    throw new Error('SESSION_SECRET é obrigatório em produção.')
  }

  const rawTrustProxyHops = env.TRUST_PROXY_HOPS ?? '0'
  const trustProxyHops = Number(rawTrustProxyHops)
  if (!/^\d+$/.test(rawTrustProxyHops) || !Number.isSafeInteger(trustProxyHops)) {
    throw new Error('TRUST_PROXY_HOPS deve ser um inteiro não negativo.')
  }

  return { production, port, appOrigin: origin.origin, databasePath, sessionSecret, trustProxyHops }
}

export function prepareDatabaseDirectory(databasePath) {
  try {
    const existingPath = statSync(databasePath, { throwIfNoEntry: false })
    if (existingPath && !existingPath.isFile()) {
      throw new Error('O caminho não é um arquivo.')
    }

    const directory = dirname(databasePath)
    mkdirSync(directory, { recursive: true })
    const probe = mkdtempSync(resolve(directory, '.nexo-write-'))
    rmdirSync(probe)
  } catch {
    throw new Error('DATABASE_PATH deve apontar para um arquivo em um diretório gravável.')
  }
}
