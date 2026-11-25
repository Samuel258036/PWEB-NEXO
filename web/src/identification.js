export const DISCREET_AUTHOR_COMMAND = 'acessar o nexo'

export const IDENTIFY_MESSAGES = {
  entryPrompt: 'O que você busca?',
  whoAreYou: 'Quem você é?',
  confirmNewAccount: 'Não conhecemos você. Novo por aqui? (y/n)',
  whatIsPassword: 'Qual é a senha?',
  invalidConfirmation: 'Responda com y ou n.',
  emptyUsername: 'Informe quem você é para continuar.',
  emptyPassword: 'Informe a senha para continuar.',
}

export function resolveDestinationFromIntent(rawIntent) {
  const trimmed = (rawIntent ?? '').trim()
  if (trimmed.toLowerCase() === DISCREET_AUTHOR_COMMAND) {
    return { kind: 'author', label: 'Área de criação' }
  }
  return { kind: 'play', name: trimmed, label: trimmed }
}

export function createInitialIdentificationState(intendedTarget = null) {
  return {
    phase: 'username', // 'username' | 'confirm_new' | 'password' | 'submitting'
    mode: null, // 'login' | 'register' | null
    username: '',
    confirmedNew: false,
    error: null,
    notice: null,
    intendedTarget,
  }
}

export function parseConfirmationAnswer(rawValue) {
  if (typeof rawValue !== 'string') return null
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'y') return true
  if (normalized === 'n') return false
  return null
}

export function identificationReducer(state, event) {
  switch (event.type) {
    case 'SET_INTENDED_TARGET': {
      return {
        ...state,
        intendedTarget: event.target ?? state.intendedTarget,
      }
    }

    case 'RESET_TO_USERNAME': {
      return {
        ...createInitialIdentificationState(state.intendedTarget),
        notice: event.notice ?? null,
      }
    }

    case 'SUBMIT_USERNAME_START': {
      const trimmed = (event.username ?? '').trim()
      if (!trimmed) {
        return {
          ...state,
          phase: 'username',
          error: IDENTIFY_MESSAGES.emptyUsername,
        }
      }
      return {
        ...state,
        phase: 'submitting',
        username: trimmed,
        confirmedNew: false,
        error: null,
        notice: null,
      }
    }

    case 'IDENTIFY_RESOLVED': {
      if (event.accountState === 'existing') {
        return {
          ...state,
          phase: 'password',
          mode: 'login',
          confirmedNew: false,
          error: null,
        }
      }
      return {
        ...state,
        phase: 'confirm_new',
        mode: 'register',
        confirmedNew: false,
        error: null,
      }
    }

    case 'CONFIRM_NEW_ANSWER': {
      if (state.phase !== 'confirm_new') return state
      const decision = parseConfirmationAnswer(event.answer)
      if (decision === true) {
        return {
          ...state,
          phase: 'password',
          mode: 'register',
          confirmedNew: true,
          error: null,
        }
      }
      if (decision === false) {
        return {
          ...createInitialIdentificationState(state.intendedTarget),
          notice: IDENTIFY_MESSAGES.whoAreYou,
        }
      }
      return {
        ...state,
        error: IDENTIFY_MESSAGES.invalidConfirmation,
      }
    }

    case 'SUBMIT_PASSWORD_START': {
      if (state.phase !== 'password') return state
      if (!event.password) {
        return {
          ...state,
          error: IDENTIFY_MESSAGES.emptyPassword,
        }
      }
      return {
        ...state,
        phase: 'submitting',
        error: null,
      }
    }

    case 'AUTH_FAILED': {
      const fallbackPhase = state.mode === 'register'
        ? (state.confirmedNew ? 'password' : 'confirm_new')
        : 'password'
      return {
        ...state,
        phase: event.code === 'NAME_TAKEN' ? 'username' : fallbackPhase,
        error: event.message || 'Não foi possível concluir a identificação.',
      }
    }

    case 'REQUEST_FAILED': {
      return {
        ...state,
        phase: state.mode ? 'password' : 'username',
        error: event.message || 'Falha de comunicação. Tente novamente.',
      }
    }

    default:
      return state
  }
}