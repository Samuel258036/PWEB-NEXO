import { useCallback, useEffect, useRef, useState } from 'react'
import DraftForm from './AuthorDraft.jsx'
import AuthorPublished from './AuthorPublished.jsx'
import { acceptPublishedResult, confirmAuthorDiscard, createEditor, draftPayload, hasAuthorChanges, publishedRequest } from './author-editor.js'

async function authorRequest(path, { csrfToken, method = 'GET', body, headers, signal } = {}) {
  const options = { method, signal }
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...headers }
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
  const editorStatus = editor?.status
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
  }, [isListing, editorId, editorStatus])

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

  function reloadEditor() {
    if (confirmAuthorDiscard(editor)) openPuzzle(editor.id)
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

  function savePublished(change) {
    return run(async (options) => {
      const { path, fields, ...request } = publishedRequest(editor, change)
      try {
        const data = await authorRequest(path, { ...options, ...request })
        setEditor(acceptPublishedResult(editor, change, data))
      } catch (error) {
        if (fields && error.fields) {
          error.fields = Object.fromEntries(Object.entries(error.fields).map(([field, message]) => [fields[field] || field, message]))
        }
        throw error
      }
      const messages = {
        final: 'Mensagem final salva.',
        step: 'Etapa salva.',
        hint: change.remove ? 'Dica removida.' : 'Dica salva.',
      }
      setFeedback({ error: false, message: messages[change.kind] })
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
          <AuthorPublished editor={editor} pending={pending} errors={feedback?.fields ?? {}} onChange={changeForm} onSave={savePublished} />
        </>
      )}

      {pending && <p role="status" className="nexo-status">Aguarde…</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'nexo-error' : 'nexo-status'}>{feedback.message}</p>}
      {editor?.id && (feedback?.conflict || editor.status === 'published') && (
        <div className="nexo-actions">
          <button type="button" className="nexo-btn-secondary" disabled={pending} onClick={reloadEditor}>Recarregar versão atual</button>
        </div>
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
