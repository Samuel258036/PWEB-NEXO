export function newDraftStep() {
  return { key: crypto.randomUUID(), prompt: '', answer: '', hints: [] }
}

export function newDraftHint() {
  return { key: crypto.randomUUID(), text: '' }
}

export function createEditor(puzzle = null) {
  const form = {
    name: puzzle?.name_display ?? '',
    finalMessage: puzzle?.final_message ?? '',
    steps: (puzzle?.steps ?? []).map((step) => ({
      id: step.id,
      key: step.id,
      prompt: step.prompt,
      answer: step.answer_text,
      locked: Boolean(step.first_solved_at),
      hints: step.hints.map((hint) => ({ id: hint.id, key: hint.id, text: hint.text })),
    })),
  }
  return { id: puzzle?.id, status: puzzle?.status ?? 'draft', version: puzzle?.version, saved: form, form }
}

export function draftPayload({ version, form }) {
  return {
    version,
    name: form.name,
    finalMessage: form.finalMessage,
    steps: form.steps.map(({ id, prompt, answer, hints }) => ({
      id,
      prompt,
      answer,
      hints: hints.map(({ id, text }) => ({ id, text })),
    })),
  }
}
