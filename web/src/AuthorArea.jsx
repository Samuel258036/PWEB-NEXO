import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { confirmAuthorDiscard, createEditor, draftPayload, hasAuthorChanges, newDraftHint, newDraftStep } from './author-editor.js'

async function authorRequest(path, { csrfToken, method = 'GET', body, signal } = {}) {
  const options = { method, signal }
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    options.body = JSON.stringify(body)
  }
  const response = await fetch('/api/author' + path, options)
  const data = await response.json().catch(() => null)
  signal?.throwIfAborted()
  if (!response.ok || !data) {
    const error = new Error(data?.error?.message || 'Não foi possível concluir a operação. Tente novamente.')
    error.code = data?.error?.code
    error.fields = data?.error?.fields
    error.status = response.status
    throw error
  }
  return data
}

function AuthorField({ label, value, onChange, multiline, readOnly, error, description }) {
  const id = useId()
  const props = {
    id,
    className: 'nexo-input nexo-author-input',
    value,
    readOnly,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || description ? id + '-description' : undefined,
    onChange: (event) => onChange?.(event.target.value),
  }
  return (
    <div className="nexo-author-field">
      <label className="nexo-label" htmlFor={id}>{label}</label>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" />}
      {(error || description) && (
        <p id={id + '-description'} className={error ? 'nexo-error' : 'nexo-warning'}>{error || description}</p>
      )}
    </div>
  )
}

function DraftForm({ editor, pending, onChange, onSave, errors }) {
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
        <AuthorField label="Nome do enigma" value={form.name} error={errors.name} onChange={(name) => onChange({ name })} />
        <h2 className="nexo-author-subheading">Etapas</h2>
        {errors.steps && <p className="nexo-error">{errors.steps}</p>}
        {form.steps.map((step, index) => (
          <fieldset className="nexo-author-section" key={step.key}>
            <legend className="nexo-author-legend">Etapa {index + 1}</legend>
            <AuthorField
              label="Enunciado" value={step.prompt} error={errors[`steps.${index}.prompt`]}
              onChange={(prompt) => saveStep(index, { prompt })} multiline
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

export default function AuthorArea({ account, csrfToken, editor, setEditor, onEntry, onLogout, onIdentityRequired, onCsrfToken }) {
  const [puzzles, setPuzzles] = useState(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [listRequest, setListRequest] = useState(0)
  const headingRef = useRef(null)
  const panelRef = useRef(null)
  const activeRequest = useRef(null)
  const isListing = !editor
  const editorId = editor?.id
  const accountId = account.id
  const dirty = hasAuthorChanges(editor)

  const showRequestError = useCallback(async (error, signal) => {
    if (signal.aborted) return
    if (error.status === 401) {
      onIdentityRequired()
      return
    }
    if (error.code === 'CSRF_INVALID') {
      try {
        const response = await fetch('/api/auth/session', { signal })
        if (response.ok) {
          const session = await response.json()
          if (signal.aborted) return
          if (session.user?.id !== accountId) {
            onIdentityRequired(session.csrfToken)
            return
          }
          onCsrfToken(session.csrfToken)
          setFeedback({ error: true, message: 'Sessão atualizada. Repita a operação.' })
          return
        }
      } catch {
        if (signal.aborted) return
      }
    }
    setFeedback({
      error: true,
      fields: error.fields,
      conflict: error.code === 'VERSION_CONFLICT',
      message: error.status ? error.message : 'Falha de comunicação. Confira a conexão e tente novamente.',
    })
  }, [accountId, onCsrfToken, onIdentityRequired])

  useEffect(() => {
    if (!isListing) return
    const controller = new AbortController()
    authorRequest('/puzzles', { signal: controller.signal })
      .then((data) => setPuzzles(data.puzzles))
      .catch((error) => showRequestError(error, controller.signal))
    return () => controller.abort()
  }, [isListing, listRequest, showRequestError])

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [isListing, editorId])

  useEffect(() => {
    if (!pending && feedback?.fields) panelRef.current?.querySelector('[aria-invalid="true"]')?.focus()
  }, [feedback, pending])

  async function run(operation) {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    const { signal } = controller
    setPending(true)
    setFeedback(null)
    try {
      await operation({ csrfToken, signal })
    } catch (error) {
      await showRequestError(error, signal)
    } finally {
      activeRequest.current = null
      if (!signal.aborted) setPending(false)
    }
  }

  function openPuzzle(id) {
    return run(async (options) => {
      const { puzzle } = await authorRequest('/puzzles/' + id, options)
      setEditor(createEditor(puzzle))
    })
  }

  function leaveEditor() {
    if (!confirmAuthorDiscard(editor)) return
    setEditor(null)
    setFeedback(null)
    setPuzzles(null)
  }

  function changeForm(updates) {
    setEditor({ ...editor, form: { ...editor.form, ...updates } })
    if (feedback?.fields) setFeedback(null)
  }

  function saveDraft(event) {
    event.preventDefault()
    return run(async (options) => {
      const path = editor.id ? '/puzzles/' + editor.id + '/draft' : '/puzzles'
      const { puzzle } = await authorRequest(path, {
        ...options,
        method: editor.id ? 'PUT' : 'POST',
        body: draftPayload(editor),
      })
      setEditor(createEditor(puzzle))
      setFeedback({ error: false, message: 'Rascunho salvo.' })
    })
  }

  function publishDraft() {
    if (!editor.id || dirty || activeRequest.current) return
    if (!window.confirm('Publicar este enigma? O nome, a quantidade e a ordem das etapas ficam fixos.')) return

    return run(async (options) => {
      const { puzzle } = await authorRequest('/puzzles/' + editor.id + '/publish', {
        ...options, method: 'POST', body: { expectedVersion: editor.version, confirmed: true },
      })
      setEditor(createEditor(puzzle))
      setFeedback({ error: false, message: 'Enigma publicado. Já é possível jogá-lo pelo nome.' })
    })
  }

  return (
    <main ref={panelRef} className="nexo-shell">
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
        <>
          <DraftForm editor={editor} pending={pending} onChange={changeForm} onSave={saveDraft} errors={feedback?.fields ?? {}} />
          <div className="nexo-actions">
            <button type="button" className="nexo-btn-secondary" disabled={pending || !editor.id || dirty} onClick={publishDraft}>Publicar enigma</button>
          </div>
          {(!editor.id || dirty) && <p className="nexo-warning">Salve o rascunho antes de publicar.</p>}
        </>
      ) : (
        <>
          <p className="nexo-status">Publicado</p>
          <p className="nexo-warning">O nome, a quantidade e a ordem das etapas estão fixos.</p>
          <h2 className="nexo-author-subheading">Etapas</h2>
          <ol>
            {editor.form.steps.map((step) => <li key={step.id} className="nexo-copy">{step.prompt}</li>)}
          </ol>
        </>
      )}

      {pending && <p role="status" className="nexo-status">Aguarde…</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'nexo-error' : 'nexo-status'}>{feedback.message}</p>}
      {feedback?.conflict && editor?.id && (
        <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={() => {
          if (confirmAuthorDiscard(editor)) openPuzzle(editor.id)
        }}>Recarregar versão atual</button>
      )}
      <div className="nexo-actions nexo-navigation">
        {editor ? (
          <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={leaveEditor}>Voltar à lista</button>
        ) : (
          <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={onEntry}>Trocar destino</button>
        )}
        <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={() => {
          if (confirmAuthorDiscard(editor)) run(onLogout)
        }}>Sair</button>
      </div>
    </main>
  )
}
