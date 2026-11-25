import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  IDENTIFY_MESSAGES,
  createInitialIdentificationState,
  identificationReducer,
} from './identification.js'

test('exige confirmação antes da senha para nova conta e aceita y/Y/n/N', () => {
  const initial = createInitialIdentificationState({ intent: 'portal secreto' })
  assert.equal(initial.phase, 'username')
  assert.deepEqual(initial.intendedTarget, { intent: 'portal secreto' })

  const submitting = identificationReducer(initial, {
    type: 'SUBMIT_USERNAME_START',
    username: '  nova_pessoa  ',
  })
  assert.equal(submitting.phase, 'submitting')
  assert.equal(submitting.username, 'nova_pessoa')

  const confirmPrompt = identificationReducer(submitting, {
    type: 'IDENTIFY_RESOLVED',
    accountState: 'new',
  })
  assert.equal(confirmPrompt.phase, 'confirm_new')
  assert.equal(confirmPrompt.confirmedNew, false)
  assert.equal(
    IDENTIFY_MESSAGES.confirmNewAccount,
    'Não conhecemos você. Novo por aqui? (y/n)',
  )

  // Respostas diferentes de y/Y/n/N mantêm confirmação e informam erro
  for (const invalidAnswer of ['talvez', 's', 'S']) {
    const invalidReply = identificationReducer(confirmPrompt, {
      type: 'CONFIRM_NEW_ANSWER',
      answer: invalidAnswer,
    })
    assert.equal(invalidReply.phase, 'confirm_new')
    assert.equal(invalidReply.confirmedNew, false)
    assert.ok(invalidReply.error)
  }

  // 'n' ou 'N' volta para informar outro nome mantendo o destino
  for (const noAnswer of ['n', 'N']) {
    const declined = identificationReducer(confirmPrompt, {
      type: 'CONFIRM_NEW_ANSWER',
      answer: noAnswer,
    })
    assert.equal(declined.phase, 'username')
    assert.deepEqual(declined.intendedTarget, { intent: 'portal secreto' })
  }

  // 'y' ou 'Y' avança para a senha com confirmedNew = true
  for (const yesAnswer of ['y', 'Y']) {
    const accepted = identificationReducer(confirmPrompt, {
      type: 'CONFIRM_NEW_ANSWER',
      answer: yesAnswer,
    })
    assert.equal(accepted.phase, 'password')
    assert.equal(accepted.mode, 'register')
    assert.equal(accepted.confirmedNew, true)
    assert.deepEqual(accepted.intendedTarget, { intent: 'portal secreto' })
  }
})

test('trata falhas de autenticação/rede e preserva o destino original', () => {
  const state = createInitialIdentificationState({ intent: 'enigma-42' })
  const withUser = identificationReducer(state, {
    type: 'SUBMIT_USERNAME_START',
    username: 'jogador',
  })
  const loginPhase = identificationReducer(withUser, {
    type: 'IDENTIFY_RESOLVED',
    accountState: 'existing',
  })
  assert.equal(loginPhase.phase, 'password')
  assert.equal(loginPhase.mode, 'login')

  const emptyPass = identificationReducer(loginPhase, {
    type: 'SUBMIT_PASSWORD_START',
    password: '',
  })
  assert.equal(emptyPass.phase, 'password')
  assert.equal(emptyPass.error, IDENTIFY_MESSAGES.emptyPassword)

  const wrongPass = identificationReducer(loginPhase, {
    type: 'AUTH_FAILED',
    code: 'AUTHENTICATION_FAILED',
    message: 'Nome ou senha incorretos.',
  })
  assert.equal(wrongPass.phase, 'password')
  assert.equal(wrongPass.error, 'Nome ou senha incorretos.')
  assert.deepEqual(wrongPass.intendedTarget, { intent: 'enigma-42' })

  const netFail = identificationReducer(loginPhase, {
    type: 'REQUEST_FAILED',
    message: 'Falha de rede.',
  })
  assert.equal(netFail.phase, 'password')
  assert.equal(netFail.error, 'Falha de rede.')
  assert.deepEqual(netFail.intendedTarget, { intent: 'enigma-42' })
})