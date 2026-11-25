import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createInitialIdentificationState,
  identificationReducer,
  resolveDestinationFromIntent,
} from './identification.js'

test('reconhece "acessar o nexo" como comando discreto de autoria e trata demais textos como enigmas', () => {
  assert.deepEqual(resolveDestinationFromIntent('acessar o nexo'), {
    kind: 'author',
    label: 'Área de criação',
  })
  assert.deepEqual(resolveDestinationFromIntent('  ACESSAR O NEXO  '), {
    kind: 'author',
    label: 'Área de criação',
  })
  assert.deepEqual(resolveDestinationFromIntent('  Portal  '), {
    kind: 'play',
    name: 'Portal',
    label: 'Portal',
  })
  assert.deepEqual(resolveDestinationFromIntent('/autoria'), {
    kind: 'play',
    name: '/autoria',
    label: '/autoria',
  })
})

test('preserva destino de jogo ou autoria durante o ciclo de identificação', () => {
  const initial = createInitialIdentificationState({ kind: 'play', name: 'Enigma Central' })
  const asked = identificationReducer(initial, { type: 'SUBMIT_USERNAME_START', username: 'jogadora' })
  const pwd = identificationReducer(asked, { type: 'IDENTIFY_RESOLVED', accountState: 'existing' })
  assert.equal(pwd.phase, 'password')
  assert.deepEqual(pwd.intendedTarget, { kind: 'play', name: 'Enigma Central' })

  const switched = identificationReducer(pwd, {
    type: 'SET_INTENDED_TARGET',
    target: { kind: 'author', label: 'Área de criação' },
  })
  assert.deepEqual(switched.intendedTarget, { kind: 'author', label: 'Área de criação' })
})