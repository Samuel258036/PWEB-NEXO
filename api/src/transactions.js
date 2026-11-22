// Keep related reads and writes in one synchronous transaction; never await inside it.
export function runInImmediateTransaction(database, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('A transação exige uma função síncrona.')
  }

  if (operation.constructor?.name === 'AsyncFunction') {
    throw new TypeError('A transação não pode aguardar trabalho assíncrono.')
  }

  database.exec('BEGIN IMMEDIATE')

  try {
    const result = operation()

    if (result && typeof result.then === 'function') {
      throw new TypeError('A transação não pode aguardar trabalho assíncrono.')
    }

    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
