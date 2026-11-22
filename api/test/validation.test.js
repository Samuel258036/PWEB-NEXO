import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ValidationError,
  validateAnswer,
  validateFinalMessage,
  validateHint,
  validateHintCount,
  validatePassword,
  validatePrompt,
  validatePuzzleName,
  validateStepCount,
  validateUsername,
} from '../src/validation.js'

function expectFieldError(callback, field) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ValidationError)
    assert.equal(error.field, field)
    assert.equal(error.code, 'INVALID_FIELD')
    return true
  })
}

test('nomes aparados mantêm a grafia e geram chaves sem apagar acentos ou espaços internos', () => {
  assert.deepEqual(validateUsername('  ÉMiLio de Sá  '), {
    display: 'ÉMiLio de Sá',
    key: 'émilio de sá',
  })
  assert.equal(validateUsername(`${' '.repeat(5)}${'u'.repeat(64)}${' '.repeat(5)}`).display, 'u'.repeat(64))
  assert.deepEqual(validatePuzzleName(' Café, com Açúcar! '), {
    display: 'Café, com Açúcar!',
    key: 'café, com açúcar!',
  })
  assert.equal(validatePuzzleName(`${' '.repeat(5)}${'n'.repeat(120)}${' '.repeat(5)}`).display, 'n'.repeat(120))
  assert.notEqual(validatePuzzleName('Cafe').key, validatePuzzleName('Café').key)
  assert.notEqual(validatePuzzleName('Ana Maria').key, validatePuzzleName('AnaMaria').key)
})

test('nomes reservados são rejeitados após normalização completa', () => {
  expectFieldError(() => validatePuzzleName(' ACESSAR O NEXO '), 'name')
  expectFieldError(() => validatePuzzleName('Criar um novo nexo'), 'name')
  assert.equal(validatePuzzleName('acessar  o nexo').key, 'acessar  o nexo')
  assert.equal(validatePuzzleName('um nexo novo').key, 'um nexo novo')
})

test('respostas reservadas comparam caixa e espaços externos, mas permitem texto comum', () => {
  expectFieldError(() => validateAnswer(' /DICA '), 'answer')
  expectFieldError(() => validateAnswer('/InIcIo'), 'answer')
  assert.deepEqual(validateAnswer(' Dica '), { text: ' Dica ', key: 'dica' })
  assert.equal(validateAnswer('/dica extra').key, '/dica extra')
  assert.equal(validateAnswer('  Ação, 2!  ').key, 'ação, 2!')
})

test('senha respeita limites e retorna exatamente o texto informado', () => {
  const password = ' AbCdef12345 '
  assert.equal(validatePassword(password), password)
  assert.notEqual(validatePassword(password), validatePassword(' abcdef12345 '))
  expectFieldError(() => validatePassword(' Abc123 '), 'password')
  expectFieldError(() => validatePassword('a'.repeat(129)), 'password')
  assert.equal(validatePassword('a'.repeat(128)), 'a'.repeat(128))
})

test('limites contam pontos de código Unicode para nomes e campos', () => {
  assert.equal(validateUsername('😀'.repeat(64)).key, '😀'.repeat(64))
  expectFieldError(() => validateUsername('😀'.repeat(65)), 'username')
  assert.equal(validatePuzzleName('n'.repeat(120)).display.length, 120)
  expectFieldError(() => validatePuzzleName('n'.repeat(121)), 'name')
  assert.equal(validateAnswer('a'.repeat(256)).key.length, 256)
  expectFieldError(() => validateAnswer('a'.repeat(257)), 'answer')
  assert.equal(validatePrompt('p'.repeat(4000)), 'p'.repeat(4000))
  expectFieldError(() => validatePrompt('p'.repeat(4001)), 'prompt')
  assert.equal(validateHint('h'.repeat(1000)), 'h'.repeat(1000))
  expectFieldError(() => validateHint('h'.repeat(1001)), 'hint')
  assert.equal(validateFinalMessage('f'.repeat(4000)), 'f'.repeat(4000))
  expectFieldError(() => validateFinalMessage('f'.repeat(4001)), 'finalMessage')
})

test('campos de uma linha recusam controles e textos longos aceitam quebras de linha', () => {
  expectFieldError(() => validateUsername('Ana\nMaria'), 'username')
  expectFieldError(() => validatePuzzleName('Nexo\tSecreto'), 'name')
  expectFieldError(() => validateAnswer('resposta\u0000'), 'answer')
  assert.equal(validatePrompt('linha 1\nlinha 2'), 'linha 1\nlinha 2')
  assert.equal(validateFinalMessage('fim\r\nmais'), 'fim\r\nmais')
  expectFieldError(() => validateHint('dica\tcom controle'), 'hint')
})

test('vazios são permitidos somente nos campos opcionais ou explicitamente em rascunhos', () => {
  expectFieldError(() => validateUsername('   '), 'username')
  expectFieldError(() => validatePuzzleName('   '), 'name')
  expectFieldError(() => validateAnswer(' '), 'answer')
  assert.deepEqual(validateAnswer('', { allowEmpty: true }), { text: '', key: '' })
  assert.equal(validatePrompt(''), '')
  assert.equal(validateFinalMessage(''), '')
  expectFieldError(() => validateHint(''), 'hint')
})

test('quantidades de etapas e dicas respeitam os máximos e aceitam zero', () => {
  assert.equal(validateStepCount(0), 0)
  assert.equal(validateStepCount(50), 50)
  expectFieldError(() => validateStepCount(-1), 'steps')
  expectFieldError(() => validateStepCount(51), 'steps')
  expectFieldError(() => validateStepCount(1.5), 'steps')
  assert.equal(validateHintCount(0), 0)
  assert.equal(validateHintCount(10), 10)
  expectFieldError(() => validateHintCount(11), 'hints')
  expectFieldError(() => validateHintCount('2'), 'hints')
})
