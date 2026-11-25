import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptPublishedResult, createEditor, hasAuthorChanges } from './author-editor.js'

test('salvar uma seção publicada preserva os textos locais das outras', () => {
  const editor = createEditor({
    id: 1, status: 'published', version: 2, name_display: 'Enigma',
    final_message: 'Final salvo',
    steps: [{ id: 2, prompt: 'Antes', answer_text: 'resposta', hints: [] }],
  })
  editor.form = {
    ...editor.form,
    finalMessage: 'Final a salvar depois',
    steps: [{ ...editor.form.steps[0], prompt: 'Depois' }],
  }
  const updated = acceptPublishedResult(editor, { kind: 'step', stepId: 2 }, {
    puzzle: { version: 3, steps: [{ id: 2, prompt: 'Depois', answer_text: 'resposta' }] },
  })
  assert.equal(updated.version, 3)
  assert.equal(updated.saved.steps[0].prompt, 'Depois')
  assert.equal(updated.saved.finalMessage, 'Final salvo')
  assert.equal(updated.form.finalMessage, 'Final a salvar depois')
  assert.equal(hasAuthorChanges(updated), true)
})

test('salvar uma nova dica publicada conserva o texto em edição de uma dica existente', () => {
  const editor = createEditor({
    id: 1, status: 'published', version: 4, name_display: 'Enigma',
    steps: [{ id: 2, prompt: 'Teste', answer_text: 'resposta', hints: [{ id: 5, text: 'Salva' }] }],
  })
  editor.form = {
    ...editor.form,
    steps: [{
      ...editor.form.steps[0],
      hints: [{ id: 5, key: 5, text: 'Ainda em edição' }, { key: 'local', text: 'Nova dica' }],
    }],
  }
  const updated = acceptPublishedResult(editor, { kind: 'hint', stepId: 2, hintKey: 'local' }, {
    version: 5, hints: [{ id: 5, text: 'Salva' }, { id: 6, text: 'Nova dica' }],
  })
  assert.equal(updated.version, 5)
  assert.equal(updated.saved.steps[0].hints[0].text, 'Salva')
  assert.deepEqual(updated.form.steps[0].hints.map((hint) => [hint.id, hint.text]), [
    [5, 'Ainda em edição'], [6, 'Nova dica'],
  ])
})
