import { useEffect, useReducer, useRef, useState } from 'react'
import {
  IDENTIFY_MESSAGES,
  createInitialIdentificationState,
  identificationReducer,
} from './identification.js'

export default function App() {
  const [screen, setScreen] = useState('entry') // 'entry' | 'identify' | 'ready'
  const [entryValue, setEntryValue] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [sessionUser, setSessionUser] = useState(null)

  const [authState, dispatchAuth] = useReducer(
    identificationReducer,
    undefined,
    () => createInitialIdentificationState(null),
  )

  const inputRef = useRef(null)
  const passwordRef = useRef(null)

  useEffect(() => {
    let active = true
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        if (data.user) setSessionUser(data.user)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (screen === 'identify' && authState.phase === 'password') {
      passwordRef.current?.focus()
      return
    }
    inputRef.current?.focus()
  }, [screen, authState.phase])

  function handleEntrySubmit(event) {
    event.preventDefault()
    const trimmed = entryValue.trim()
    if (!trimmed) return

    const intendedTarget = { intent: trimmed }
    dispatchAuth({ type: 'SET_INTENDED_TARGET', target: intendedTarget })

    if (sessionUser) {
      setScreen('ready')
      return
    }

    setInputValue('')
    setPasswordValue('')
    dispatchAuth({ type: 'RESET_TO_USERNAME', notice: null })
    setScreen('identify')
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
        if (data.csrfToken) setCsrfToken(data.csrfToken)
        if (data.user) setSessionUser(data.user)
        setScreen('ready')
      } catch {
        dispatchAuth({
          type: 'REQUEST_FAILED',
          message: 'Não foi possível concluir o acesso agora. Tente novamente.',
        })
      }
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

  return (
    <main className="nexo-shell">
      <h1 className="nexo-prompt-heading">Destino preservado</h1>
      <p className="nexo-status">
        Intenção: {authState.intendedTarget?.intent ?? ''}
      </p>
      {sessionUser && (
        <p className="nexo-status">
          Conta: {sessionUser.usernameDisplay}
        </p>
      )}
    </main>
  )
}