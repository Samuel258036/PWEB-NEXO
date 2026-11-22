import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { validatePassword } from './validation.js'

const parameters = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const saltSize = 16
const keySize = 64
const maximumWaitingHashes = 4
const hashQueue = []
let hashIsRunning = false

export class PasswordHashQueueFullError extends Error {
  constructor() {
    super('A verificação de senha está temporariamente ocupada. Tente novamente.')
    this.name = 'PasswordHashQueueFullError'
    this.code = 'PASSWORD_HASH_QUEUE_FULL'
  }
}

function runNextHash() {
  if (hashIsRunning || hashQueue.length === 0) {
    return
  }

  hashIsRunning = true
  const request = hashQueue.shift()

  Promise.resolve()
    .then(request.operation)
    .then((result) => {
      hashIsRunning = false
      request.resolve(result)
      runNextHash()
    }, (error) => {
      hashIsRunning = false
      request.reject(error)
      runNextHash()
    })
}

function runWithHashSlot(operation) {
  return new Promise((resolve, reject) => {
    if (hashIsRunning && hashQueue.length >= maximumWaitingHashes) {
      reject(new PasswordHashQueueFullError())
      return
    }

    hashQueue.push({ operation, resolve, reject })
    runNextHash()
  })
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keySize, parameters, (error, key) => {
      if (error) {
        reject(new Error('Não foi possível processar a senha.'))
        return
      }

      resolve(key)
    })
  })
}

function parseHash(encodedHash) {
  if (typeof encodedHash !== 'string') {
    return null
  }

  const parts = encodedHash.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v=1' ||
      parts[2] !== `N=${parameters.N}` || parts[3] !== `r=${parameters.r}` ||
      parts[4] !== `p=${parameters.p}` || !/^[a-f\d]{32,256}$/i.test(parts[5]) ||
      parts[5].length % 2 !== 0 || !/^[a-f\d]{128}$/i.test(parts[6])) {
    return null
  }

  return { salt: Buffer.from(parts[5], 'hex'), key: Buffer.from(parts[6], 'hex') }
}

export function hashPassword(password) {
  const validPassword = validatePassword(password)

  return runWithHashSlot(async () => {
    const salt = randomBytes(saltSize)
    const key = await deriveKey(validPassword, salt)
    return `scrypt$v=1$N=${parameters.N}$r=${parameters.r}$p=${parameters.p}$${salt.toString('hex')}$${key.toString('hex')}`
  })
}

export function verifyPassword(password, encodedHash) {
  let validPassword

  try {
    validPassword = validatePassword(password)
  } catch {
    return Promise.resolve(false)
  }

  const parsedHash = parseHash(encodedHash)
  if (!parsedHash) {
    return Promise.resolve(false)
  }

  return runWithHashSlot(async () => {
    const candidateKey = await deriveKey(validPassword, parsedHash.salt)
    return timingSafeEqual(candidateKey, parsedHash.key)
  })
}
