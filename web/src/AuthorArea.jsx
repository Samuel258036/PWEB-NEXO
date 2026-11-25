import { useEffect, useId, useRef, useState } from 'react'
import { createEditor, draftPayload, newDraftHint, newDraftStep } from './author-editor.js'

async function authorRequest(path, { csrfToken, method = 'GET', body, signal } = {}) {
  const options = { method, signal }
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    options.body = JSON.stringify(body)
  }
  const response = await fetch('/api/author' + path, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    const error = new Error(data?.error?.message || 'Não foi possível concluir a operação. Tente novamente.')
    error.code = data?.error?.code
    error.fields = data?.error?.fields
    error.status = response.status
    throw error
  }
  return data
}

function AuthorField({ label, value, onChange, multiline, readOnly }) {
  const id = useId()
  const props = {
    id,
    className: 'nexo-input nexo-author-input',
    value,
    readOnly,
    onChange: (event) => onChange?.(event.target.value),
  }
  return (
    <div className="nexo-author-field">
      <label className="nexo-label" htmlFor={id}>{label}</label>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" />}
    </div>
  )
}

function DraftForm({ editor, pending, onChange, onSave }) {
  const { form } = editor
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
        <AuthorField label="Nome do enigma" value={form.name} onChange={(name) => onChange({ name })} />
        <h2 className="nexo-author-subheading">Etapas</h2>
        {form.steps.map((step, index) => (
          <fieldset className="nexo-author-section" key={step.key}>
            <legend className="nexo-author-legend">Etapa {index + 1}</legend>
            <AuthorField label="Enunciado" value={step.prompt} onChange={(prompt) => saveStep(index, { prompt })} multiline />
            <AuthorField label="Resposta correta" value={step.answer} onChange={(answer) => saveStep(index, { answer })} />
            {step.hints.map((hint, hintIndex) => (
              <div className="nexo-author-hint" key={hint.key}>
                <AuthorField
                  label={'Dica ' + (hintIndex + 1)}
                  value={hint.text}
                  multiline
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
              <button type="button" className="nexo-btn-secondary" disabled={step.hints.length >= 10} onClick={() => saveStep(index, {
                hints: [...step.hints, newDraftHint()],
              })}>Adicionar dica</button>
              <button type="button" className="nexo-btn-secondary" disabled={index === 0} onClick={() => moveStep(index, -1)}>Mover etapa para cima</button>
              <button type="button" className="nexo-btn-secondary" disabled={index === form.steps.length - 1} onClick={() => moveStep(index, 1)}>Mover etapa para baixo</button>
              <button type="button" className="nexo-btn-secondary" onClick={() => onChange({
                steps: form.steps.filter((item) => item.key !== step.key),
              })}>Remover etapa</button>
            </div>
          </fieldset>
        ))}
        <div className="nexo-actions">
          <button type="button" className="nexo-btn-secondary" disabled={form.steps.length >= 50} onClick={() => onChange({
            steps: [...form.steps, newDraftStep()],
          })}>Adicionar etapa</button>
        </div>
        <AuthorField label="Mensagem final (opcional)" value={form.finalMessage} onChange={(finalMessage) => onChange({ finalMessage })} multiline />
        <div className="nexo-actions">
          <button type="submit" className="nexo-btn-primary">Salvar rascunho</button>
        </div>
      </fieldset>
    </form>
  )
}

export default function AuthorArea({ account, csrfToken, editor, setEditor, onEntry, onLogout }) {
  const [puzzles, setPuzzles] = useState(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [listRequest, setListRequest] = useState(0)
  const headingRef = useRef(null)
  const activeRequest = useRef(false)
  const isListing = !editor
  const editorId = editor?.id

  useEffect(() => {
    if (!isListing) return
    const controller = new AbortController()
    authorRequest('/puzzles', { signal: controller.signal })
      .then((data) => setPuzzles(data.puzzles))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFeedback({ error: true, message: error.message })
        }
      })
    return () => controller.abort()
  }, [isListing, listRequest])

  useEffect(() => {
    headingRef.current?.focus()
  }, [isListing, editorId])

  async function run(operation) {
    if (activeRequest.current) return
    activeRequest.current = true
    setPending(true)
    setFeedback(null)
    try {
      await operation()
    } catch (error) {
      setFeedback({ error: true, message: error.message })
    } finally {
      activeRequest.current = false
      setPending(false)
    }
  }

  function openPuzzle(id) {
    return run(async () => {
      const { puzzle } = await authorRequest('/puzzles/' + id)
      setEditor(createEditor(puzzle))
    })
  }

  function leaveEditor() {
    setEditor(null)
    setFeedback(null)
    setPuzzles(null)
  }

  function changeForm(updates) {
    setEditor({ ...editor, form: { ...editor.form, ...updates } })
  }

  function saveDraft(event) {
    event.preventDefault()
    return run(async () => {
      const path = editor.id ? '/puzzles/' + editor.id + '/draft' : '/puzzles'
      const { puzzle } = await authorRequest(path, {
        csrfToken,
        method: editor.id ? 'PUT' : 'POST',
        body: draftPayload(editor),
      })
      setEditor(createEditor(puzzle))
      setFeedback({ error: false, message: 'Rascunho salvo.' })
    })
  }

  return (
    <main className="nexo-shell">
      <h1 ref={headingRef} tabIndex={-1} className="nexo-prompt-heading">
        {isListing ? 'Seus enigmas' : editor.status === 'published' ? editor.form.name : 'Rascunho'}
      </h1>

      {isListing ? (
        <>
          <p className="nexo-status">Conta: {account.usernameDisplay}</p>
          <div className="nexo-actions">
            <button type="button" className="nexo-btn-primary" disabled={pending} onClick={() => {
              setFeedback(null)
              setEditor(createEditor())
            }}>Criar um novo nexo</button>
          </div>
          {puzzles === null && !feedback && <p role="status" className="nexo-status">Carregando enigmas…</p>}
          {puzzles === null && feedback && (
            <button type="button" className="nexo-btn-secondary" onClick={() => {
              setFeedback(null)
              setListRequest(listRequest + 1)
            }}>Tentar novamente</button>
          )}
          {puzzles?.length === 0 && <p className="nexo-status">Você ainda não tem enigmas salvos.</p>}
          {puzzles?.length > 0 && (
            <ul className="nexo-author-list">
              {puzzles.map((puzzle) => (
                <li key={puzzle.id}>
                  <div className="nexo-author-item">
                    <strong>{puzzle.name}</strong>
                    <span className="nexo-status">{puzzle.status === 'draft' ? 'Rascunho' : 'Publicado'}</span>
                  </div>
                  <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={() => openPuzzle(puzzle.id)}>
                    {puzzle.status === 'draft' ? 'Continuar rascunho' : 'Abrir publicado'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : editor.status === 'draft' ? (
        <DraftForm editor={editor} pending={pending} onChange={changeForm} onSave={saveDraft} />
      ) : (
        <p className="nexo-status">Publicado · {editor.form.steps.length} etapa(s).</p>
      )}

      {pending && <p role="status" className="nexo-status">Aguarde…</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'nexo-error' : 'nexo-status'}>{feedback.message}</p>}
      <div className="nexo-actions nexo-navigation">
        {editor ? (
          <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={leaveEditor}>Voltar à lista</button>
        ) : (
          <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={onEntry}>Trocar destino</button>
        )}
        <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={onLogout}>Sair</button>
      </div>
    </main>
  )
}
