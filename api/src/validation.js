const reservedPuzzleNames = new Set([
  'acessar o nexo',
  'criar um novo nexo',
])

const reservedAnswers = new Set(['/dica', '/inicio'])

export class ValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
    this.code = 'INVALID_FIELD'
  }
}

function normalizeComparisonText(value) {
  return value.trim().toLowerCase()
}

function countCodePoints(value) {
  return [...value].length
}

function validateText(value, field, {
  min = 1,
  max,
  multiline = false,
  allowEmpty = false,
  countTrimmed = false,
} = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} deve ser texto.`)
  }

  const trimmed = value.trim()
  const isEmpty = trimmed.length === 0
  if (!allowEmpty && isEmpty) {
    throw new ValidationError(field, `${field} não pode ficar vazio.`)
  }

  const lengthValue = countTrimmed ? trimmed : value
  const length = countCodePoints(lengthValue)
  if (((!allowEmpty || !isEmpty) && length < min) || length > max) {
    throw new ValidationError(field, `${field} deve ter entre ${min} e ${max} caracteres.`)
  }

  const textWithoutLineBreaks = multiline ? value.replace(/\r?\n/g, '') : value
  if (/[\p{Cc}\u2028\u2029]/u.test(textWithoutLineBreaks)) {
    throw new ValidationError(field, `${field} não pode conter caracteres de controle.`)
  }

  return value
}

export function validateUsername(value) {
  validateText(value, 'username', { max: 64, countTrimmed: true })
  const display = value.trim()
  return { display, key: normalizeComparisonText(display) }
}

export function validatePuzzleName(value) {
  validateText(value, 'name', { max: 120, countTrimmed: true })
  const display = value.trim()
  const key = normalizeComparisonText(display)

  if (reservedPuzzleNames.has(key)) {
    throw new ValidationError('name', 'Esse nome é reservado.')
  }

  return { display, key }
}

export function validateAnswer(value, { allowEmpty = false } = {}) {
  validateText(value, 'answer', { max: 256, allowEmpty })
  const key = normalizeComparisonText(value)

  if (reservedAnswers.has(key)) {
    throw new ValidationError('answer', 'Essa resposta é reservada para um comando.')
  }

  return { text: value, key }
}

export function validatePassword(value) {
  if (typeof value !== 'string') {
    throw new ValidationError('password', 'password deve ser texto.')
  }

  const length = countCodePoints(value)
  if (length < 12 || length > 128) {
    throw new ValidationError('password', 'password deve ter entre 12 e 128 caracteres.')
  }

  return value
}

export function validatePrompt(value, { allowEmpty = true } = {}) {
  return validateText(value, 'prompt', { max: 4000, multiline: true, allowEmpty })
}

export function validateHint(value) {
  return validateText(value, 'hint', { max: 1000, multiline: true })
}

export function validateFinalMessage(value, { allowEmpty = true } = {}) {
  return validateText(value, 'finalMessage', { max: 4000, multiline: true, allowEmpty })
}

export function validateStepCount(count) {
  if (!Number.isInteger(count) || count < 0 || count > 50) {
    throw new ValidationError('steps', 'steps deve ser um inteiro entre 0 e 50.')
  }

  return count
}

export function validateHintCount(count) {
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    throw new ValidationError('hints', 'hints deve ser um inteiro entre 0 e 10.')
  }

  return count
}
