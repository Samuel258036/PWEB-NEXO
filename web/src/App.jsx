import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import AuthorArea from './AuthorArea.jsx'
import {
  IDENTIFY_MESSAGES,
  createInitialIdentificationState,
  identificationReducer,
  resolveDestinationFromIntent,
} from './identification.js'

const PUZZLE_UNAVAILABLE = 'Não encontramos esse nexo.'

export default function App() {
  const [screen, setScreen] = useState('entry') // 'entry' | 'identify' | 'play' | 'author'
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
    undefined,
    () => createInitialIdentificationState(null),
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

  async function openDestination(target, token) {
    if (target.kind === 'author') {
      setEntryValue('')
      setScreen('author')
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

  const syncSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session')
      if (!res.ok) return
      const data = await res.json()
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken)
      }
      if (data.user) {
        setSessionUser(data.user)
      } else {
        setSessionUser((prevUser) => {
          if (prevUser && (screen === 'play' || screen === 'author')) {
            handleSessionExpired()
          }
          return null
        })
      }
    } catch {
      // ignora falha transitória de rede na verificação silenciosa
    }
  }, [handleSessionExpired, screen])

  useEffect(() => {
    let active = true
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        setSessionUser(data.user ?? null)
      })
      .catch(() => {})

    const onFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncSession()
      }
    }

    window.addEventListener('focus', onFocusOrVisibility)
    document.addEventListener('visibilitychange', onFocusOrVisibility)

    return () => {
      active = false
      window.removeEventListener('focus', onFocusOrVisibility)
      document.removeEventListener('visibilitychange', onFocusOrVisibility)
    }
  }, [syncSession])

  const currentStepId = playState?.currentStep?.id
  const playStatus = playState?.status
  useEffect(() => {
    if (screen === 'identify' && authState.phase === 'password') {
      passwordRef.current?.focus()
      return
    }
    if (screen === 'play' && playStatus !== 'in_progress') {
      startButtonRef.current?.focus()
      return
    }
    inputRef.current?.focus()
  }, [screen, authState.phase, currentStepId, playStatus])

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
        if (data.user) setSessionUser(data.user)

        if (authState.intendedTarget) {
          await openDestination(authState.intendedTarget, nextCsrf)
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
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
      })
      const data = await res.json().catch(() => ({}))
      if (data?.csrfToken) {
        setCsrfToken(data.csrfToken)
      }
    } catch {
      // mesmo em falha de rede, limpa sessão local e exige nova identificação
    }

    setSessionUser(null)
    returnToEntry('Sessão encerrada.')
  }

  function returnToEntry(message) {
    cancelPlayRequest()
    setPlayState(null)
    setAuthorWork(null)
    setEntryValue('')
    setInputValue('')
    setErrorMessage('')
    setStatusMessage(message)
    setScreen('entry')
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
    const isPasswordPhase = authState.phase === 'password'
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
                disabled={authState.phase === 'submitting'}
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
                disabled={authState.phase === 'submitting'}
              />
            )}
          </div>

          {authState.phase === 'submitting' && (
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
              disabled={authState.phase === 'submitting'}
            >
              Continuar
            </button>
            <button
              type="button"
              className="nexo-btn-secondary"
              onClick={() => {
                setInputValue('')
                setPasswordValue('')
                dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
                setScreen('entry')
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
        setEditor={(editor) => setAuthorWork(editor ? { accountId: sessionUser.id, editor } : null)}
        onEntry={() => returnToEntry('')}
        onLogout={handleLogout}
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

