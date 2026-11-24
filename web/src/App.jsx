import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  IDENTIFY_MESSAGES,
  createInitialIdentificationState,
  identificationReducer,
} from './identification.js'

const DISCREET_AUTHOR_COMMAND = '/autoria'

function resolveDestinationFromIntent(rawIntent) {
  const trimmed = rawIntent.trim()
  if (trimmed.toLowerCase() === DISCREET_AUTHOR_COMMAND) {
    return { kind: 'author', label: 'Área de criação' }
  }
  return { kind: 'play', name: trimmed, label: trimmed }
}

export default function App() {
  const [screen, setScreen] = useState('entry') // 'entry' | 'identify' | 'play' | 'author'
  const [entryValue, setEntryValue] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [sessionUser, setSessionUser] = useState(null)
  const [playState, setPlayState] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [authState, dispatchAuth] = useReducer(
    identificationReducer,
    undefined,
    () => createInitialIdentificationState(null),
  )

  const inputRef = useRef(null)
  const passwordRef = useRef(null)

  const handleSessionExpired = useCallback((message = 'Sua sessão expirou ou foi encerrada. Identifique-se novamente.') => {
    setSessionUser(null)
    setPlayState(null)
    setInputValue('')
    setPasswordValue('')
    dispatchAuth({ type: 'RESET_TO_USERNAME', notice: message })
    setScreen('identify')
  }, [])

  const openDestination = useCallback(async (target, activeCsrfToken) => {
    setErrorMessage('')
    setStatusMessage('')

    if (!target) {
      setScreen('entry')
      return
    }

    if (target.kind === 'author') {
      setScreen('author')
      return
    }

    try {
      const res = await fetch('/api/play/puzzles/open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeCsrfToken ? { 'X-CSRF-Token': activeCsrfToken } : {}),
        },
        body: JSON.stringify({ name: target.name }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        handleSessionExpired()
        return
      }

      if (!res.ok) {
        setPlayState(null)
        setErrorMessage(data?.error?.message || 'Não foi possível abrir esse destino.')
        setScreen('entry')
        return
      }

      setPlayState(data.play)
      setScreen('play')
    } catch {
      setErrorMessage('Falha de comunicação ao abrir o destino. Tente novamente.')
      setScreen('entry')
    }
  }, [handleSessionExpired])

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

  useEffect(() => {
    if (screen === 'identify' && authState.phase === 'password') {
      passwordRef.current?.focus()
      return
    }
    inputRef.current?.focus()
  }, [screen, authState.phase, playState?.currentStep?.id])

  async function handleEntrySubmit(event) {
    event.preventDefault()
    const trimmed = entryValue.trim()
    if (!trimmed) return

    const target = resolveDestinationFromIntent(trimmed)
    dispatchAuth({ type: 'SET_INTENDED_TARGET', target })
    setErrorMessage('')
    setStatusMessage('')
    setEntryValue('')

    if (!sessionUser) {
      setInputValue('')
      setPasswordValue('')
      dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
      setScreen('identify')
      return
    }

    await openDestination(target, csrfToken)
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
    setPlayState(null)
    setStatusMessage('Sessão encerrada.')
    setScreen('entry')
  }

  async function handleSwitchDestination(nextTarget) {
    dispatchAuth({ type: 'SET_INTENDED_TARGET', target: nextTarget })
    if (!sessionUser) {
      setInputValue('')
      setPasswordValue('')
      dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
      setScreen('identify')
      return
    }
    await openDestination(nextTarget, csrfToken)
  }

  async function handleAnswerSubmit(event) {
    event.preventDefault()
    if (!playState || playState.status !== 'in_progress' || !playState.currentStep) return

    const rawAnswer = inputValue
    const normalizedCommand = rawAnswer.trim().toLowerCase()

    if (normalizedCommand === '/inicio') {
      setInputValue('')
      setErrorMessage('')
      setStatusMessage('Partida preservada.')
      setScreen('entry')
      return
    }

    setErrorMessage('')
    setStatusMessage('')

    try {
      const res = await fetch(`/api/play/puzzles/${playState.puzzle.id}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          stepId: playState.currentStep.id,
          expectedVersion: playState.version,
          answer: rawAnswer,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        handleSessionExpired()
        return
      }

      if (res.status === 409 && data?.error?.code === 'STALE_PROGRESS') {
        if (data.play) {
          setPlayState(data.play)
        } else {
          const refreshRes = await fetch(`/api/play/puzzles/${playState.puzzle.id}`)
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json()
            if (refreshData.play) setPlayState(refreshData.play)
          }
        }
        setErrorMessage(data?.error?.message || 'O estado da partida mudou. Etapa atualizada.')
        return
      }

      if (!res.ok) {
        setErrorMessage(data?.error?.message || 'Não foi possível enviar a resposta.')
        return
      }

      setInputValue('')
      if (data.play) {
        setPlayState(data.play)
      }

      if (data.correct === false) {
        setErrorMessage('Resposta incorreta. Tente novamente.')
      }
    } catch {
      setErrorMessage('Falha de comunicação ao enviar a resposta. Tente novamente.')
    }
  }

  if (screen === 'entry') {
    return (
      <main className="nexo-shell">
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
            />
          </div>
        </form>

        {errorMessage && (
          <p className="nexo-error" role="alert">{errorMessage}</p>
        )}

        {statusMessage && (
          <p className="nexo-status" role="status">{statusMessage}</p>
        )}

        {sessionUser && (
          <div className="nexo-actions">
            <button
              type="button"
              className="nexo-btn-secondary"
              onClick={() => handleSwitchDestination({ kind: 'author', label: 'Área de criação' })}
            >
              Criar / autoria
            </button>
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
      ? IDENTIFY_MESSAGES.confirmNewAccount(authState.username)
      : isPasswordPhase
        ? IDENTIFY_MESSAGES.whatIsPassword
        : IDENTIFY_MESSAGES.whoAreYou

    return (
      <main className="nexo-shell">
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

  if (screen === 'author') {
    return (
      <main className="nexo-shell">
        <h1 className="nexo-prompt-heading">Seus enigmas</h1>
        {sessionUser && (
          <p className="nexo-status">Conta: {sessionUser.usernameDisplay}</p>
        )}
        <div className="nexo-actions">
          <button
            type="button"
            className="nexo-btn-secondary"
            onClick={() => setScreen('entry')}
          >
            Trocar destino
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

  return (
    <main className="nexo-shell">
      <h1 className="nexo-prompt-heading">{playState?.puzzle?.name ?? 'Partida'}</h1>

      {playState?.status === 'in_progress' && playState?.currentStep && (
        <form onSubmit={handleAnswerSubmit}>
          <p className="nexo-status" style={{ whiteSpace: 'pre-wrap' }}>
            {playState.currentStep.prompt}
          </p>

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
            />
          </div>

          <div className="nexo-actions">
            <button type="submit" className="nexo-btn-primary">
              Enviar
            </button>
            <button
              type="button"
              className="nexo-btn-secondary"
              onClick={() => {
                setInputValue('')
                setErrorMessage('')
                setStatusMessage('Partida preservada.')
                setScreen('entry')
              }}
            >
              Início
            </button>
          </div>
        </form>
      )}

      {playState?.status === 'completed' && (
        <p className="nexo-status" style={{ whiteSpace: 'pre-wrap' }}>
          {playState.finalMessage || 'Enigma concluído.'}
        </p>
      )}

      {errorMessage && (
        <p className="nexo-error" role="alert">{errorMessage}</p>
      )}

      {statusMessage && (
        <p className="nexo-status" role="status">{statusMessage}</p>
      )}

      <div className="nexo-actions">
        <button
          type="button"
          className="nexo-btn-secondary"
          onClick={() => handleSwitchDestination({ kind: 'author', label: 'Área de criação' })}
        >
          Criar / autoria
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