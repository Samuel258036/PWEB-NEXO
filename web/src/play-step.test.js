import assert from 'node:assert/strict'
import { test } from 'node:test'

function isStartCommand(rawValue) {
  return typeof rawValue === 'string' && rawValue.trim().toLowerCase() === '/inicio'
}

function applyPlayTransition(currentPlay, nextPlay) {
  // Avançar substitui integralmente currentStep sem acumular histórico anterior
  return {
    ...nextPlay,
    previousStepRemoved: currentPlay?.currentStep?.id !== nextPlay?.currentStep?.id,
  }
}

test('avançar substitui a etapa anterior sem histórico e /inicio preserva a partida', () => {
  assert.equal(isStartCommand('/inicio'), true)
  assert.equal(isStartCommand('  /INICIO  '), true)
  assert.equal(isStartCommand('resposta'), false)

  const step1State = {
    puzzle: { id: 1, name: 'Torre' },
    status: 'in_progress',
    version: 1,
    currentStep: { id: 10, position: 1, prompt: 'Enunciado 1' },
  }
  const step2State = {
    puzzle: { id: 1, name: 'Torre' },
    status: 'in_progress',
    version: 2,
    currentStep: { id: 11, position: 2, prompt: 'Enunciado 2' },
  }

  const transitioned = applyPlayTransition(step1State, step2State)
  assert.equal(transitioned.currentStep.id, 11)
  assert.equal(transitioned.currentStep.prompt, 'Enunciado 2')
  assert.equal(JSON.stringify(transitioned.currentStep).includes('Enunciado 1'), false)
  assert.equal(transitioned.previousStepRemoved, true)
})