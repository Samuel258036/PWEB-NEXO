import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import AuthorArea from './AuthorArea.jsx'
import { confirmAuthorDiscard, createEditor, hasAuthorChanges } from './author-editor.js'
import {
  IDENTIFY_MESSAGES,
  LOGOUT_FAILED,
  createInitialIdentificationState,
  identificationReducer,
  resolveDestinationFromIntent,
  resolveDirectAuthorTarget,
} from './identification.js'

const PUZZLE_UNAVAILABLE = 'Não encontramos esse nexo.'

export default function App() {
  const [directAuthorTarget] = useState(() => resolveDirectAuthorTarget(window.location.pathname))
  const [screen, setScreen] = useState(directAuthorTarget ? 'author-loading' : 'entry')
  const [entryValue, setEntryValue] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [sessionUser, setSessionUser] = useState(null)
  const [playState, setPlayState] = useState(null)
  const [authorWork, setAuthorWork] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [playPendingMessage, setPlayPendingMessage] = useState('')

  const [authState, dispatchAuth] = useReducer(
    identificationReducer,
    directAuthorTarget,
    createInitialIdentificationState,
  )

  const inputRef = useRef(null)
  const passwordRef = useRef(null)
  const startButtonRef = useRef(null)
  const playRequestRef = useRef(null)

  const cancelPlayRequest = useCallback(() => {
    playRequestRef.current?.abort()
    playRequestRef.current = null
    setPlayPendingMessage('')
  }, [])

  const handleSessionExpired = useCallback((message = 'Sua sessão expirou ou foi encerrada. Identifique-se novamente.') => {
    cancelPlayRequest()
    setSessionUser(null)
    setPlayState(null)
    setInputValue('')
    setPasswordValue('')
    dispatchAuth({ type: 'RESET_TO_USERNAME', notice: message })
    setScreen('identify')
  }, [cancelPlayRequest])

  async function requestPlay({ path, payload, token = csrfToken, pendingMessage, failureMessage }) {
    if (playRequestRef.current) return

    const controller = new AbortController()
    const { signal } = controller
    playRequestRef.current = controller
    setPlayPendingMessage(pendingMessage)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const options = { signal }
      if (payload) {
        options.method = 'POST'
        options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token }
        options.body = JSON.stringify(payload)
      }
      const res = await fetch(`/api/play/puzzles${path}`, options)
      const data = await res.json()
      if (signal.aborted) return

      if (res.status === 401) {
        handleSessionExpired()
        return
      }

      const errorCode = data.error?.code
      if (errorCode === 'CSRF_INVALID') {
        const sessionResponse = await fetch('/api/auth/session', { signal })
        if (sessionResponse.ok) {
          const session = await sessionResponse.json()
          if (signal.aborted) return
          setCsrfToken(session.csrfToken)
          if (!session.user || session.user.id !== sessionUser?.id) {
            handleSessionExpired()
            return
          }
          setErrorMessage('A sessão foi atualizada. Tente novamente.')
          return
        }
      }

      if (errorCode === 'PUZZLE_UNAVAILABLE') {
        setPlayState(null)
        setInputValue('')
        setErrorMessage(PUZZLE_UNAVAILABLE)
        return
      }

      const staleProgress = errorCode === 'STALE_PROGRESS'
      if (!res.ok && !staleProgress) {
        setErrorMessage(data.error?.message || failureMessage)
        return
      }

      if (!data.play) throw new Error('Resposta da partida incompleta.')
      if (data.play.currentStep?.id !== playState?.currentStep?.id || data.correct !== undefined) {
        setInputValue('')
      }
      setPlayState(data.play)
      if (path === '/open') {
        setEntryValue('')
        setScreen('play')
      }
      if (staleProgress) setStatusMessage('A partida foi atualizada.')
      if (data.correct === false) setErrorMessage('Resposta incorreta. Tente novamente.')
    } catch {
      if (!signal.aborted) setErrorMessage(failureMessage)
    } finally {
      if (playRequestRef.current === controller) {
        playRequestRef.current = null
        setPlayPendingMessage('')
      }
    }
  }

  const openAuthor = useCallback((target, account) => {
    if (target.newDraft && account) {
      setAuthorWork((current) => current?.accountId === account.id
        ? current
        : { accountId: account.id, editor: createEditor() })
    }
    setEntryValue('')
    setScreen('author')
  }, [])

  async function openDestination(target, token, account = sessionUser) {
    if (target.kind === 'author') {
      openAuthor(target, account)
      return
    }

    setEntryValue(target.name)
    setScreen('entry')
    await requestPlay({
      path: '/open',
      payload: { name: target.name },
      token,
      pendingMessage: 'Abrindo partida…',
      failureMessage: 'Falha de comunicação ao abrir a partida. Tente novamente.',
    })
  }

  const reidentifyAuthor = useCallback((token) => {
    if (token) setCsrfToken(token)
    handleSessionExpired()
  }, [handleSessionExpired])

  const sessionAccountId = sessionUser?.id
  const setAuthorEditor = useCallback((editor) => {
    setAuthorWork(editor ? { accountId: sessionAccountId, editor } : null)
    const currentPath = window.location.pathname
    if (!resolveDirectAuthorTarget(currentPath)) return
    const path = editor?.id ? '/nexo/' + editor.id : editor ? '/nexo/novo' : '/nexo'
    if (path !== currentPath) {
      window.history.replaceState(window.history.state, '', path)
      dispatchAuth({ type: 'SET_INTENDED_TARGET', target: resolveDirectAuthorTarget(path) })
    }
  }, [sessionAccountId])

  useEffect(() => {
    let request
    async function syncSession() {
      request?.abort()
      request = new AbortController()
      const { signal } = request
      try {
        const res = await fetch('/api/auth/session', { signal })
        if (!res.ok) {
          if (screen === 'author-loading') setErrorMessage('Não foi possível verificar a sessão.')
          return
        }
        const data = await res.json()
        if (signal.aborted) return
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        if (screen === 'author-loading') {
          setSessionUser(data.user ?? null)
          if (data.user) openAuthor(directAuthorTarget, data.user)
          else setScreen('identify')
          return
        }
        if ((screen === 'play' || screen === 'author') && data.user?.id !== sessionAccountId) {
          handleSessionExpired()
          return
        }
        setSessionUser(data.user ?? null)
      } catch {
        if (screen === 'author-loading' && !signal.aborted) setErrorMessage('Não foi possível verificar a sessão.')
      }
    }

    const onFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncSession()
      }
    }

    syncSession()
    window.addEventListener('focus', onFocusOrVisibility)
    document.addEventListener('visibilitychange', onFocusOrVisibility)

    return () => {
      request?.abort()
      window.removeEventListener('focus', onFocusOrVisibility)
      document.removeEventListener('visibilitychange', onFocusOrVisibility)
    }
  }, [directAuthorTarget, handleSessionExpired, openAuthor, screen, sessionAccountId])

  const authorHasChanges = hasAuthorChanges(authorWork?.editor)
  useEffect(() => {
    if (!authorHasChanges) return
    const protectChanges = (event) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', protectChanges)
    return () => window.removeEventListener('beforeunload', protectChanges)
  }, [authorHasChanges])

  const currentStepId = playState?.currentStep?.id
  const playStatus = playState?.status
  const isSubmittingIdentity = authState.phase === 'submitting'
  const isPasswordPhase = authState.phase === 'password' || (isSubmittingIdentity && authState.mode !== null)
  useEffect(() => {
    if (screen === 'identify' && isPasswordPhase) {
      passwordRef.current?.focus()
      return
    }
    if (screen === 'play' && playStatus !== 'in_progress') {
      startButtonRef.current?.focus()
      return
    }
    inputRef.current?.focus()
  }, [screen, authState.phase, isPasswordPhase, currentStepId, playStatus])

  async function handleEntrySubmit(event) {
    event.preventDefault()
    if (playRequestRef.current) return
    const trimmed = entryValue.trim()
    if (!trimmed) return

    const target = resolveDestinationFromIntent(trimmed)
    dispatchAuth({ type: 'SET_INTENDED_TARGET', target })
    setErrorMessage('')
    setStatusMessage('')
    if (!sessionUser) {
      setEntryValue('')
      setInputValue('')
      setPasswordValue('')
      dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
      setScreen('identify')
      return
    }

    await openDestination(target, csrfToken)
  }

  async function handleRevealHint() {
    if (!playState?.currentStep) return
    inputRef.current?.focus()

    await requestPlay({
      path: `/${playState.puzzle.id}/hints/reveal`,
      payload: { stepId: playState.currentStep.id, expectedVersion: playState.version },
      pendingMessage: 'Solicitando dica…',
      failureMessage: 'Falha de comunicação ao solicitar a dica. Tente novamente.',
    })
  }

  async function handleIdentifySubmit(event) {
    event.preventDefault()
    if (authState.phase === 'submitting') return

    if (authState.phase === 'username') {
      dispatchAuth({ type: 'SUBMIT_USERNAME_START', username: inputValue })
      const trimmedUsername = inputValue.trim()
      if (!trimmedUsername) return

      try {
        const res = await fetch('/api/auth/identify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({ username: trimmedUsername }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          dispatchAuth({
            type: 'AUTH_FAILED',
            code: data?.error?.code,
            message: data?.error?.message,
          })
          return
        }
        setInputValue('')
        dispatchAuth({ type: 'IDENTIFY_RESOLVED', accountState: data.state })
      } catch {
        dispatchAuth({
          type: 'REQUEST_FAILED',
          message: 'Não foi possível verificar o nome agora. Tente novamente.',
        })
      }
      return
    }

    if (authState.phase === 'confirm_new') {
      const answer = inputValue
      setInputValue('')
      dispatchAuth({ type: 'CONFIRM_NEW_ANSWER', answer })
      return
    }

    if (authState.phase === 'password') {
      dispatchAuth({ type: 'SUBMIT_PASSWORD_START', password: passwordValue })
      if (!passwordValue) return

      const isRegister = authState.mode === 'register'
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const payload = isRegister
        ? {
            username: authState.username,
            password: passwordValue,
            confirmedNew: true,
          }
        : {
            username: authState.username,
            password: passwordValue,
          }

      setPasswordValue('')

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          dispatchAuth({
            type: 'AUTH_FAILED',
            code: data?.error?.code,
            message: data?.error?.message,
          })
          return
        }

        const nextCsrf = data.csrfToken || csrfToken
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        if (data.user) {
          setSessionUser(data.user)
          setAuthorWork((current) => current?.accountId === data.user.id ? current : null)
        }

        if (authState.intendedTarget) {
          await openDestination(authState.intendedTarget, nextCsrf, data.user)
        } else {
          setScreen('entry')
        }
      } catch {
        dispatchAuth({
          type: 'REQUEST_FAILED',
          message: 'Não foi possível concluir o acesso agora. Tente novamente.',
        })
      }
    }
  }

  async function handleLogout() {
    cancelPlayRequest()
    setErrorMessage('')
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
    }).catch(() => null)
    if (!response?.ok) {
      const check = await fetch('/api/auth/session').catch(() => null)
      const session = check?.ok ? await check.json().catch(() => null) : null
      if (session?.csrfToken) setCsrfToken(session.csrfToken)
      if (session?.user !== null) {
        if (screen !== 'author') setErrorMessage(LOGOUT_FAILED)
        return false
      }
    }

    setSessionUser(null)
    returnToEntry('Sessão encerrada.')
    return true
  }

  function returnToEntry(message) {
    cancelPlayRequest()
    if (resolveDirectAuthorTarget(window.location.pathname)) {
      window.history.replaceState(window.history.state, '', '/')
    }
    setPlayState(null)
    setAuthorWork(null)
    setEntryValue('')
    setInputValue('')
    setErrorMessage('')
    setStatusMessage(message)
    setScreen('entry')
    if (screen === 'entry') inputRef.current?.focus()
  }

  async function handleAnswerSubmit(event) {
    event.preventDefault()
    if (!playState || playState.status !== 'in_progress' || !playState.currentStep) return

    const rawAnswer = inputValue
    const normalizedCommand = rawAnswer.trim().toLowerCase()

    if (normalizedCommand === '/inicio') {
      returnToEntry('Partida preservada.')
      return
    }

    if (playRequestRef.current) return
    inputRef.current?.focus()

    if (normalizedCommand === '/dica') {
      setInputValue('')
      await handleRevealHint()
      return
    }

    await requestPlay({
      path: `/${playState.puzzle.id}/answer`,
      payload: { stepId: playState.currentStep.id, expectedVersion: playState.version, answer: rawAnswer },
      pendingMessage: 'Enviando resposta…',
      failureMessage: 'Falha de comunicação ao enviar a resposta. Tente novamente.',
    })
  }

  const DEFAULT_COMPLETION_MESSAGE = 'Enigma concluído.'

  const resolveCompletionMessage = (play) => {
    if (!play) return DEFAULT_COMPLETION_MESSAGE
    const customMessage = typeof play.finalMessage === 'string' ? play.finalMessage.trim() : ''
    return customMessage.length > 0 ? play.finalMessage : DEFAULT_COMPLETION_MESSAGE
  }

  async function handleRefreshCompletedPlay() {
    await requestPlay({
      path: `/${playState.puzzle.id}`,
      pendingMessage: 'Atualizando mensagem…',
      failureMessage: 'Falha de comunicação ao atualizar a conclusão. Tente novamente.',
    })
  }

  if (screen === 'author-loading') {
    return (
      <main className="nexo-shell nexo-shell--prompt">
        {errorMessage ? (
          <>
            <p className="nexo-error" role="alert">{errorMessage}</p>
            <button type="button" className="nexo-btn-secondary" onClick={() => window.location.reload()}>Tentar novamente</button>
          </>
        ) : <p className="nexo-status" role="status">Verificando sessão…</p>}
      </main>
    )
  }

  if (screen === 'entry') {
    return (
      <main className="nexo-shell nexo-shell--prompt">
        <form onSubmit={handleEntrySubmit}>
          <label htmlFor="entry-intent" className="nexo-prompt-heading">
            {IDENTIFY_MESSAGES.entryPrompt}
          </label>
          <div className="nexo-input-row">
            <span className="nexo-prefix" aria-hidden="true">&gt;</span>
            <input
              ref={inputRef}
              id="entry-intent"
              type="text"
              className="nexo-input"
              value={entryValue}
              onChange={(event) => setEntryValue(event.target.value)}
              autoComplete="off"
              readOnly={Boolean(playPendingMessage)}
            />
          </div>
        </form>

        {playPendingMessage && (
          <p className="nexo-status" role="status">{playPendingMessage}</p>
        )}

        {errorMessage && (
          <p className="nexo-error" role="alert">{errorMessage}</p>
        )}

        {statusMessage && (
          <p className="nexo-status" role="status">{statusMessage}</p>
        )}

        {sessionUser && (
          <div className="nexo-actions nexo-navigation">
            <button
              type="button"
              className="nexo-btn-secondary"
              onClick={handleLogout}
            >
              Sair
            </button>
          </div>
        )}
      </main>
    )
  }

  if (screen === 'identify') {
    const showSignupNotice = authState.phase === 'confirm_new' || (isPasswordPhase && authState.mode === 'register')
    const activeLabel = authState.phase === 'confirm_new'
      ? IDENTIFY_MESSAGES.confirmNewAccount
      : isPasswordPhase
        ? IDENTIFY_MESSAGES.whatIsPassword
        : IDENTIFY_MESSAGES.whoAreYou

    return (
      <main className="nexo-shell nexo-shell--prompt">
        <form onSubmit={handleIdentifySubmit}>
          <label
            htmlFor={isPasswordPhase ? 'identify-password' : 'identify-input'}
            className="nexo-prompt-heading"
          >
            {activeLabel}
          </label>

          <div className="nexo-input-row">
            <span className="nexo-prefix" aria-hidden="true">&gt;</span>
            {isPasswordPhase ? (
              <input
                ref={passwordRef}
                id="identify-password"
                type="password"
                className="nexo-input"
                value={passwordValue}
                onChange={(event) => setPasswordValue(event.target.value)}
                autoComplete={authState.mode === 'register' ? 'new-password' : 'current-password'}
                readOnly={isSubmittingIdentity}
                aria-describedby={showSignupNotice ? 'signup-notice' : undefined}
              />
            ) : (
              <input
                ref={inputRef}
                id="identify-input"
                type="text"
                className="nexo-input"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                autoComplete={authState.phase === 'username' ? 'username' : 'off'}
                readOnly={isSubmittingIdentity}
                aria-describedby={showSignupNotice ? 'signup-notice' : undefined}
              />
            )}
          </div>

          {showSignupNotice && <p id="signup-notice" className="nexo-warning">Guarde sua senha. O Nexo não oferece recuperação de acesso.</p>}

          {isSubmittingIdentity && (
            <p className="nexo-status" role="status">Verificando…</p>
          )}

          {authState.notice && (
            <p className="nexo-warning">{authState.notice}</p>
          )}

          {authState.error && (
            <p className="nexo-error" role="alert">{authState.error}</p>
          )}

          <div className="nexo-actions">
            <button
              type="submit"
              className="nexo-btn-primary"
              disabled={isSubmittingIdentity}
            >
              Continuar
            </button>
            <button
              type="button"
              className="nexo-btn-secondary"
              disabled={isSubmittingIdentity}
              onClick={() => {
                if (!confirmAuthorDiscard(authorWork?.editor)) return
                setPasswordValue('')
                dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
                returnToEntry('')
              }}
            >
              Voltar
            </button>
          </div>
        </form>
      </main>
    )
  }

  if (screen === 'author' && sessionUser) {
    return (
      <AuthorArea
        key={sessionUser.id}
        account={sessionUser}
        csrfToken={csrfToken}
        editor={authorWork?.accountId === sessionUser.id ? authorWork.editor : null}
        initialPuzzleId={authState.intendedTarget?.puzzleId}
        setEditor={setAuthorEditor}
        onEntry={() => returnToEntry('')}
        onLogout={handleLogout}
        onIdentityRequired={reidentifyAuthor}
        onCsrfToken={setCsrfToken}
      />
    )
  }

  return (
    <main className="nexo-shell">
      <h1 className="nexo-prompt-heading">{playState?.puzzle?.name ?? 'Partida'}</h1>

      {playState?.status === 'in_progress' && playState?.currentStep && (
        <form onSubmit={handleAnswerSubmit}>
          <p className="nexo-copy">
            {playState.currentStep.prompt}
          </p>

          <div aria-live="polite">
            {Array.isArray(playState.currentStep.revealedHints) && playState.currentStep.revealedHints.length > 0 && (
              <div className="nexo-hints" aria-label="Dicas reveladas">
                {playState.currentStep.revealedHints.map((hint) => (
                  <p key={hint.id} className="nexo-copy">
                    Dica {hint.position}: {hint.text}
                  </p>
                ))}
              </div>
            )}

            {playState.currentStep.hasMoreHints === false && (
              <p className="nexo-warning">
                Não há mais dicas disponíveis para esta etapa.
              </p>
            )}
          </div>

          <label htmlFor="play-answer" className="nexo-label">
            Resposta
          </label>
          <div className="nexo-input-row">
            <span className="nexo-prefix" aria-hidden="true">&gt;</span>
            <input
              ref={inputRef}
              id="play-answer"
              type="text"
              className="nexo-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              autoComplete="off"
              readOnly={Boolean(playPendingMessage)}
            />
          </div>

          <div className="nexo-actions">
            <button type="submit" className="nexo-btn-primary" disabled={Boolean(playPendingMessage)}>
              Enviar
            </button>
            {playState.currentStep.hasMoreHints !== false && (
              <button
                type="button"
                className="nexo-btn-secondary"
                onClick={handleRevealHint}
                disabled={Boolean(playPendingMessage)}
              >
                Pedir dica
              </button>
            )}
          </div>
        </form>
      )}

      {playState?.status === 'completed' && (
        <div>
          <p className="nexo-copy">
            {resolveCompletionMessage(playState)}
          </p>
          <div className="nexo-actions">
            <button
              type="button"
              className="nexo-btn-secondary"
              onClick={handleRefreshCompletedPlay}
              disabled={Boolean(playPendingMessage)}
            >
              Atualizar mensagem
            </button>
          </div>
        </div>
      )}

      {playPendingMessage && (
        <p className="nexo-status" role="status">{playPendingMessage}</p>
      )}

      {errorMessage && (
        <p className="nexo-error" role="alert">{errorMessage}</p>
      )}

      {statusMessage && (
        <p className="nexo-status" role="status">{statusMessage}</p>
      )}

      <div className="nexo-actions nexo-navigation">
        <button
          ref={startButtonRef}
          type="button"
          className="nexo-btn-secondary"
          onClick={() => returnToEntry(currentStepId ? 'Partida preservada.' : '')}
        >
          Início
        </button>
        <button
          type="button"
          className="nexo-btn-secondary"
          onClick={handleLogout}
        >
          Sair
        </button>
      </div>
    </main>
  )
}

