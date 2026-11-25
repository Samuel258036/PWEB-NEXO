import { useState } from 'react'
import AuthorField from './AuthorField.jsx'
import { newDraftHint } from './author-editor.js'

export default function AuthorPublished({ editor, pending, errors, onChange, onSave }) {
  const { form, saved } = editor
  const [newFieldKey, setNewFieldKey] = useState(null)
  function changeStep(stepId, updates) {
    onChange({ steps: form.steps.map((step) => step.id === stepId ? { ...step, ...updates } : step) })
  }

  return (
    <fieldset className="nexo-author-form" disabled={pending}>
      <legend className="nexo-author-legend">Conteúdo publicado</legend>
      <p className="nexo-warning">O nome, a quantidade e a ordem das etapas estão fixos.</p>
      <h2 className="nexo-author-subheading">Etapas</h2>
      {form.steps.map((step, index) => {
        const savedStep = saved.steps[index]
        const stepPath = 'steps.' + index
        const stepChanged = step.prompt !== savedStep.prompt || step.answer !== savedStep.answer
        return (
          <fieldset className="nexo-author-section" key={step.id}>
            <legend className="nexo-author-legend">Etapa {index + 1}</legend>
            <AuthorField
              label="Enunciado" value={step.prompt} error={errors[stepPath + '.prompt']}
              multiline onChange={(prompt) => changeStep(step.id, { prompt })}
            />
            <AuthorField
              label="Resposta correta" value={step.answer} error={errors[stepPath + '.answer']}
              readOnly={step.locked}
              description={step.locked ? 'Resposta bloqueada pelo primeiro acerto de um jogador.' : undefined}
              onChange={(answer) => changeStep(step.id, { answer })}
            />
            <button type="button" className="nexo-btn-secondary" disabled={!stepChanged} onClick={() => onSave({
              kind: 'step', stepId: step.id,
            })}>Salvar etapa</button>
            <h3 className="nexo-author-subheading">Dicas</h3>
            {errors[stepPath + '.hints'] && <p className="nexo-error">{errors[stepPath + '.hints']}</p>}
            {step.hints.map((hint, hintIndex) => {
              const savedHint = savedStep.hints.find((item) => item.id === hint.id)
              const change = { kind: 'hint', stepId: step.id, hintKey: hint.key }
              return (
                <div className="nexo-author-hint" key={hint.key}>
                  <AuthorField
                    label={'Dica ' + (hintIndex + 1)}
                    value={hint.text}
                    error={errors[stepPath + '.hints.' + hintIndex + '.text']}
                    multiline autoFocus={newFieldKey === hint.key}
                    onChange={(text) => changeStep(step.id, {
                      hints: step.hints.map((item) => item.key === hint.key ? { ...item, text } : item),
                    })}
                  />
                  <div className="nexo-actions">
                    <button type="button" className="nexo-btn-secondary" disabled={savedHint?.text === hint.text}
                      onClick={() => onSave(change)}>Salvar dica {hintIndex + 1}</button>
                    <button type="button" className="nexo-btn-secondary" onClick={() => {
                      if (hint.id) onSave({ ...change, remove: true })
                      else changeStep(step.id, { hints: step.hints.filter((item) => item.key !== hint.key) })
                    }}>Remover dica {hintIndex + 1}</button>
                  </div>
                </div>
              )
            })}
            <div className="nexo-actions">
              <button type="button" className="nexo-btn-secondary"
                disabled={step.hints.length >= 10 || step.hints.some((hint) => !hint.id)}
                onClick={() => {
                  const hint = newDraftHint()
                  setNewFieldKey(hint.key)
                  changeStep(step.id, { hints: [...step.hints, hint] })
                }}>Adicionar dica</button>
            </div>
          </fieldset>
        )
      })}
      <AuthorField
        label="Mensagem final (opcional)" value={form.finalMessage} error={errors.finalMessage}
        multiline onChange={(finalMessage) => onChange({ finalMessage })}
      />
      <button type="button" className="nexo-btn-primary" disabled={form.finalMessage === saved.finalMessage}
        onClick={() => onSave({ kind: 'final' })}>Salvar mensagem final</button>
    </fieldset>
  )
}
