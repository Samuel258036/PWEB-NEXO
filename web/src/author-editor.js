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

export function hasAuthorChanges(editor) {
  return Boolean(editor && editor.form !== editor.saved &&
    JSON.stringify(editor.form) !== JSON.stringify(editor.saved))
}

export function confirmAuthorDiscard(editor) {
  return !hasAuthorChanges(editor) ||
    window.confirm('As alterações desde o último salvamento serão perdidas. Deseja continuar?')
}

export function publishedRequest(editor, change) {
  const expectedVersion = editor.version
  if (change.kind === 'final') {
    return {
      path: '/puzzles/' + editor.id + '/final-message',
      method: 'PATCH',
      body: { finalMessage: editor.form.finalMessage, expectedVersion },
    }
  }

  const index = editor.form.steps.findIndex((step) => step.id === change.stepId)
  const step = editor.form.steps[index]
  const stepPath = 'steps.' + index
  if (change.kind === 'step') {
    return {
      path: '/steps/' + step.id + '/content',
      method: 'PATCH',
      body: { prompt: step.prompt, answer: step.answer, expectedVersion },
      fields: { prompt: stepPath + '.prompt', answer: stepPath + '.answer' },
    }
  }

  const hintIndex = step.hints.findIndex((hint) => hint.key === change.hintKey)
  const hint = step.hints[hintIndex]
  if (change.remove) {
    return { path: '/hints/' + hint.id, method: 'DELETE', headers: { 'If-Match': String(expectedVersion) } }
  }

  return {
    path: hint.id ? '/hints/' + hint.id : '/steps/' + step.id + '/hints',
    method: hint.id ? 'PATCH' : 'POST',
    body: { text: hint.text, expectedVersion },
    fields: { text: stepPath + '.hints.' + hintIndex + '.text', hints: stepPath + '.hints' },
  }
}

function updateStep(form, stepId, updates) {
  return {
    ...form,
    steps: form.steps.map((step) => step.id === stepId ? { ...step, ...updates } : step),
  }
}

export function acceptPublishedResult(editor, change, data) {
  if (change.kind === 'final') {
    const finalMessage = data.puzzle.final_message ?? ''
    return {
      ...editor,
      version: data.puzzle.version,
      saved: { ...editor.saved, finalMessage },
      form: { ...editor.form, finalMessage },
    }
  }
  const stepId = change.stepId
  if (change.kind === 'step') {
    const step = data.puzzle.steps.find((item) => item.id === stepId)
    const content = { prompt: step.prompt, answer: step.answer_text, locked: Boolean(step.first_solved_at) }
    return {
      ...editor,
      version: data.puzzle.version,
      saved: updateStep(editor.saved, stepId, content),
      form: updateStep(editor.form, stepId, content),
    }
  }

  const step = editor.form.steps.find((item) => item.id === stepId)
  const localHints = step.hints
  const changedHint = localHints.find((hint) => hint.key === change.hintKey)
  const persisted = data.hints.map(({ id, text }) => ({ id, key: id, text }))
  const savedId = changedHint.id ?? persisted.at(-1)?.id
  const editable = persisted.map((hint) => {
    if (hint.id === savedId) return hint
    return localHints.find((local) => local.id === hint.id) ?? hint
  })
  for (const hint of localHints) {
    if (!hint.id && hint.key !== change.hintKey) editable.push(hint)
  }
  return {
    ...editor,
    version: data.version,
    saved: updateStep(editor.saved, stepId, { hints: persisted }),
    form: updateStep(editor.form, stepId, { hints: editable }),
  }
}
