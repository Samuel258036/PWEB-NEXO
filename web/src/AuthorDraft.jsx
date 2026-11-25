import { useState } from 'react'
import AuthorField from './AuthorField.jsx'
import { newDraftHint, newDraftStep } from './author-editor.js'

export default function DraftForm({ editor, pending, onChange, onSave, errors }) {
  const { form } = editor
  const [newFieldKey, setNewFieldKey] = useState(null)
  const saveStep = (index, updates) => {
    onChange({ steps: form.steps.map((step, position) => position === index ? { ...step, ...updates } : step) })
  }
  const moveStep = (index, offset) => {
    const steps = [...form.steps]
    const destination = index + offset
    const moving = steps[index]
    steps[index] = steps[destination]
    steps[destination] = moving
    onChange({ steps })
  }

  return (
    <form onSubmit={onSave} noValidate>
      <fieldset className="nexo-author-form" disabled={pending}>
        <legend className="nexo-author-legend">Dados do rascunho</legend>
        <AuthorField label="Nome do enigma" value={form.name} error={errors.name} onChange={(name) => onChange({ name })} />
        <h2 className="nexo-author-subheading">Etapas</h2>
        {errors.steps && <p className="nexo-error">{errors.steps}</p>}
        {form.steps.map((step, index) => (
          <fieldset className="nexo-author-section" key={step.key}>
            <legend className="nexo-author-legend">Etapa {index + 1}</legend>
            <AuthorField
              label="Enunciado" value={step.prompt} error={errors[`steps.${index}.prompt`]}
              onChange={(prompt) => saveStep(index, { prompt })} multiline autoFocus={newFieldKey === step.key}
            />
            <AuthorField
              label="Resposta correta" value={step.answer} error={errors[`steps.${index}.answer`]}
              onChange={(answer) => saveStep(index, { answer })}
            />
            {errors[`steps.${index}.hints`] && <p className="nexo-error">{errors[`steps.${index}.hints`]}</p>}
            {step.hints.map((hint, hintIndex) => (
              <div className="nexo-author-hint" key={hint.key}>
                <AuthorField
                  label={'Dica ' + (hintIndex + 1)}
                  value={hint.text}
                  error={errors[`steps.${index}.hints.${hintIndex}.text`]}
                  multiline autoFocus={newFieldKey === hint.key}
                  onChange={(text) => saveStep(index, {
                    hints: step.hints.map((item) => item.key === hint.key ? { ...item, text } : item),
                  })}
                />
                <button type="button" className="nexo-btn-secondary" onClick={() => saveStep(index, {
                  hints: step.hints.filter((item) => item.key !== hint.key),
                })}>Remover dica {hintIndex + 1}</button>
              </div>
            ))}
            <div className="nexo-actions">
              <button type="button" className="nexo-btn-secondary" disabled={step.hints.length >= 10} onClick={() => {
                const hint = newDraftHint()
                setNewFieldKey(hint.key)
                saveStep(index, { hints: [...step.hints, hint] })
              }}>Adicionar dica</button>
              <button type="button" className="nexo-btn-secondary" disabled={index === 0} onClick={() => moveStep(index, -1)}>Mover etapa para cima</button>
              <button type="button" className="nexo-btn-secondary" disabled={index === form.steps.length - 1} onClick={() => moveStep(index, 1)}>Mover etapa para baixo</button>
              <button type="button" className="nexo-btn-secondary" onClick={() => onChange({
                steps: form.steps.filter((item) => item.key !== step.key),
              })}>Remover etapa</button>
            </div>
          </fieldset>
        ))}
        <div className="nexo-actions">
          <button type="button" className="nexo-btn-secondary" disabled={form.steps.length >= 50} onClick={() => {
            const step = newDraftStep()
            setNewFieldKey(step.key)
            onChange({ steps: [...form.steps, step] })
          }}>Adicionar etapa</button>
        </div>
        <AuthorField
          label="Mensagem final (opcional)" value={form.finalMessage}
          error={errors.finalMessage} onChange={(finalMessage) => onChange({ finalMessage })} multiline
        />
        <div className="nexo-actions">
          <button type="submit" className="nexo-btn-primary">Salvar rascunho</button>
        </div>
      </fieldset>
    </form>
  )
}
