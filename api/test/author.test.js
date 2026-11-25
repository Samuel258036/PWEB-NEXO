import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createRepositories } from '../src/repositories.js'
import { hashPassword } from '../src/passwords.js'

async function setup(context) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-author-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)
  const accounts = []
  for (const username of ['autora', 'jogadora']) {
    const result = repositories.users.create({ usernameDisplay: username, usernameKey: username, passwordHash: await hashPassword('senha de teste segura') })
    accounts.push(result.lastInsertRowid)
  }
  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-autoria' })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  app.locals.appOrigin = origin
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    app.locals.sessionStore.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { origin, accounts, database }
}

async function login(origin, username) {
  const initial = await fetch(`${origin}/api/auth/session`)
  const initialCookie = initial.headers.get('set-cookie').split(';')[0]
  const initialBody = await initial.json()
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie: initialCookie, 'x-csrf-token': initialBody.csrfToken },
    body: JSON.stringify({ username, password: 'senha de teste segura' }),
  })
  const body = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken }
}

async function authorRequest(origin, session, path, method = 'GET', body) {
  const headers = { cookie: session.cookie, origin }
  if (method !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrfToken
  }
  const response = await fetch(`${origin}${path}`, { method, headers, body: body && JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test('rascunho salva snapshot com IDs estáveis, renomeia e ordena etapas', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const first = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Primeiro nome' })
  const puzzleId = first.body.puzzle.id
  const created = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome atualizado', version: 1,
    steps: [{ prompt: 'A', answer: 'um' }, { prompt: 'B', answer: 'dois' }],
  })
  assert.equal(created.status, 200)
  const [stepA, stepB] = created.body.puzzle.steps
  const reordered = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome final', version: created.body.puzzle.version,
    steps: [{ id: stepB.id, prompt: 'B alterado', answer: 'dois' }, { id: stepA.id, prompt: 'A alterado', answer: 'um' }],
  })
  assert.equal(reordered.body.puzzle.steps[0].id, stepB.id)
  assert.equal(reordered.body.puzzle.steps[1].id, stepA.id)
  assert.deepEqual(reordered.body.puzzle.steps.map((step) => step.position), [1, 2])
  assert.equal(reordered.body.puzzle.name_display, 'Nome final')

  const foreignStep = await authorRequest(origin, other, '/api/author/puzzles', 'POST', { name: 'Outro rascunho' })
  const foreignContent = await authorRequest(origin, other, `/api/author/puzzles/${foreignStep.body.puzzle.id}/draft`, 'PUT', {
    name: 'Outro rascunho', version: 1, steps: [{ prompt: 'Privado', answer: 'privado' }],
  })
  const rejected = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome final', version: reordered.body.puzzle.version,
    steps: [{ id: foreignContent.body.puzzle.steps[0].id, prompt: '', answer: '' }],
  })
  assert.equal(rejected.status, 404)
})

test('primeiro salvamento e alterações do rascunho preservam conteúdo e identidades em uma transação', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const path = '/api/author/puzzles'
  const created = await authorRequest(origin, author, path, 'POST', {
    name: '  Portal  ',
    finalMessage: 'Fim do portal.',
    steps: [
      { prompt: 'Substituir esta etapa' },
      { prompt: 'Manter', answer: 'queda', hints: [{ text: 'Primeira' }, { text: 'Segunda' }] },
    ],
  })
  assert.equal(created.status, 201)
  const puzzle = created.body.puzzle
  const savedStep = puzzle.steps[1]
  const [firstHint, secondHint] = savedStep.hints
  assert.equal(puzzle.name_display, 'Portal')
  assert.equal(puzzle.final_message, 'Fim do portal.')
  assert.equal((await authorRequest(origin, other, path, 'POST', { name: ' PORTAL ' })).status, 409)

  const invalid = await authorRequest(origin, other, path, 'POST', {
    name: 'Reserva provisória',
    steps: [{ hints: [firstHint] }],
  })
  assert.equal(invalid.status, 404)
  assert.equal((await authorRequest(origin, other, path)).body.puzzles.length, 0)
  assert.equal((await authorRequest(origin, other, path, 'POST', { name: 'Reserva provisória' })).status, 201)

  const update = { name: 'Portal', version: puzzle.version }
  const pathToDraft = path + '/' + puzzle.id + '/draft'
  const reordered = await authorRequest(origin, author, pathToDraft, 'PUT', {
    ...update,
    steps: [{ id: savedStep.id, hints: [secondHint, firstHint] }],
  })
  assert.equal(reordered.status, 400)
  assert.ok(reordered.body.error.fields['steps.0.hints'])

  const replaced = await authorRequest(origin, author, pathToDraft, 'PUT', {
    ...update,
    finalMessage: 'Conclusão revisada.',
    steps: [{ prompt: 'Nova etapa' }, {
      id: savedStep.id, prompt: 'Manter', answer: 'queda',
      hints: [{ id: secondHint.id, text: 'Segunda revisada' }, { text: 'Acrescentada' }],
    }],
  })
  assert.equal(replaced.status, 200)
  const resumed = await authorRequest(origin, author, path + '/' + puzzle.id)
  assert.equal(resumed.body.puzzle.final_message, 'Conclusão revisada.')
  assert.notEqual(resumed.body.puzzle.steps[0].id, puzzle.steps[0].id)
  assert.equal(resumed.body.puzzle.steps[1].id, savedStep.id)
  assert.deepEqual(resumed.body.puzzle.steps[1].hints.map((hint) => [hint.position, hint.text]), [
    [1, 'Segunda revisada'], [2, 'Acrescentada'],
  ])
  assert.equal(resumed.body.puzzle.steps[1].hints[0].id, secondHint.id)
})

test('publicação exige snapshot completo e congela a estrutura do rascunho', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const draft = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Publicável' })
  const puzzleId = draft.body.puzzle.id
  const emptyPublish = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', { expectedVersion: 1 })
  assert.equal(emptyPublish.status, 400)
  assert.equal(emptyPublish.body.error.code, 'DRAFT_INCOMPLETE')
  assert.ok(emptyPublish.body.error.fields.steps)

  const incomplete = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Publicável', version: 1, steps: [{ prompt: '\n \n\u00a0', answer: '  ' }],
  })
  const rejected = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: incomplete.body.puzzle.version,
  })
  assert.equal(rejected.status, 400)
  assert.ok(rejected.body.error.fields['steps.0.prompt'])
  assert.ok(rejected.body.error.fields['steps.0.answer'])

  const snapshot = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Publicável', version: incomplete.body.puzzle.version, steps: [{ prompt: 'Enunciado', answer: 'resposta' }],
  })
  const published = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', { expectedVersion: snapshot.body.puzzle.version })
  assert.equal(published.status, 200)
  assert.equal(published.body.puzzle.status, 'published')
  assert.ok(published.body.puzzle.published_at)

  const mutation = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Publicável', version: published.body.puzzle.version, steps: [],
  })
  assert.equal(mutation.status, 404)
})

test('manutenção publicada edita enunciado e mensagem, bloqueia resposta resolvida e acrescenta dica ao fim', async (context) => {
  const { origin, database } = await setup(context)
  const author = await login(origin, 'autora')
  const draft = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Conteúdo editável' })
  const id = draft.body.puzzle.id
  const saved = await authorRequest(origin, author, `/api/author/puzzles/${id}/draft`, 'PUT', {
    name: 'Conteúdo editável', version: 1, steps: [{ prompt: 'Antes', answer: 'resposta' }],
  })
  const published = await authorRequest(origin, author, `/api/author/puzzles/${id}/publish`, 'POST', { expectedVersion: saved.body.puzzle.version })
  const stepId = published.body.puzzle.steps[0].id
  const firstHint = await authorRequest(origin, author, `/api/author/steps/${stepId}/hints`, 'POST', { text: 'Dica inicial', expectedVersion: published.body.puzzle.version })
  const secondHint = await authorRequest(origin, author, `/api/author/steps/${stepId}/hints`, 'POST', { text: 'Dica final', expectedVersion: published.body.puzzle.version + 1 })
  assert.equal(firstHint.body.hints[0].position, 1)
  assert.equal(secondHint.body.hints[1].position, 2)
  assert.equal(secondHint.body.hints[0].id, firstHint.body.hints[0].id)

  database.prepare('UPDATE steps SET first_solved_at = CURRENT_TIMESTAMP WHERE id = ?').run(stepId)
  const edited = await authorRequest(origin, author, `/api/author/steps/${stepId}/content`, 'PATCH', {
    prompt: 'Depois', answer: 'resposta alterada', expectedVersion: published.body.puzzle.version + 2,
  })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.puzzle.steps[0].prompt, 'Depois')
  assert.equal(edited.body.puzzle.steps[0].answer_text, 'resposta')
  const message = await authorRequest(origin, author, `/api/author/puzzles/${id}/final-message`, 'PATCH', {
    finalMessage: 'Você concluiu.', expectedVersion: edited.body.puzzle.version,
  })
  assert.equal(message.body.puzzle.final_message, 'Você concluiu.')
  assert.equal((await authorRequest(origin, author, `/api/author/puzzles/${id}/pause`, 'POST', {})).status, 404)
})

test('exclusão confirmada remove cascatas, mantém contas e libera o nome', async (context) => {
  const { origin, database, accounts } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const draft = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Nome liberado' })
  const puzzleId = draft.body.puzzle.id
  const saved = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Nome liberado', version: 1, steps: [{ prompt: 'Passo', answer: 'solução' }],
  })
  const published = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', { expectedVersion: saved.body.puzzle.version })
  const stepId = published.body.puzzle.steps[0].id
  const hintId = Number(database.prepare('INSERT INTO hints (step_id, position, text) VALUES (?, 1, ?)').run(stepId, 'Dica').lastInsertRowid)
  const progressId = Number(database.prepare('INSERT INTO progress (user_id, puzzle_id, current_step_id) VALUES (?, ?, ?)').run(accounts[1], puzzleId, stepId).lastInsertRowid)
  database.prepare('INSERT INTO hint_reveals (progress_id, hint_id) VALUES (?, ?)').run(progressId, hintId)

  const missingConfirmation = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}`, 'DELETE', { expectedVersion: published.body.puzzle.version })
  assert.equal(missingConfirmation.status, 400)
  const deleted = await authorRequest(origin, author, `/api/author/puzzles/${puzzleId}`, 'DELETE', {
    confirmed: true, expectedVersion: published.body.puzzle.version,
  })
  assert.equal(deleted.status, 200)
  assert.equal(database.prepare('SELECT count(*) AS count FROM progress WHERE puzzle_id = ?').get(puzzleId).count, 0)
  assert.equal(database.prepare('SELECT count(*) AS count FROM hints WHERE id = ?').get(hintId).count, 0)
  assert.ok(database.prepare('SELECT id FROM users WHERE id = ?').get(accounts[0]))
  const reused = await authorRequest(origin, other, '/api/author/puzzles', 'POST', { name: 'Nome liberado' })
  assert.equal(reused.status, 201)
  assert.notEqual(reused.body.puzzle.id, puzzleId)
})

test('autor lista, cria e retoma rascunho; outra conta não lê seu conteúdo', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const other = await login(origin, 'jogadora')
  const created = await authorRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Enigma de teste' })
  assert.equal(created.status, 201)
  assert.equal(created.body.puzzle.status, 'draft')
  assert.deepEqual(created.body.puzzle.steps, [])

  const id = created.body.puzzle.id
  const resumed = await authorRequest(origin, author, `/api/author/puzzles/${id}`)
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.puzzle.name_display, 'Enigma de teste')
  assert.deepEqual((await authorRequest(origin, author, '/api/author/puzzles')).body.puzzles.length, 1)
  assert.equal((await authorRequest(origin, other, `/api/author/puzzles/${id}`)).status, 404)
})
