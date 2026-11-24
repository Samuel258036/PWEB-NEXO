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
  const directory = mkdtempSync(join(tmpdir(), 'nexo-play-'))
  const database = new DatabaseSync(join(directory, 'nexo.sqlite'))
  database.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  const repositories = createRepositories(database)
  const accounts = {}
  for (const username of ['autora', 'jogadora1', 'jogadora2']) {
    const result = repositories.users.create({
      usernameDisplay: username,
      usernameKey: username,
      passwordHash: await hashPassword('senha de teste segura'),
    })
    accounts[username] = Number(result.lastInsertRowid)
  }
  const app = createApp({ database, sessionSecret: 'segredo-estavel-para-teste-de-jogo' })
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
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: initialCookie,
      'x-csrf-token': initialBody.csrfToken,
    },
    body: JSON.stringify({ username, password: 'senha de teste segura' }),
  })
  const body = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken }
}

async function apiRequest(origin, session, path, method = 'GET', body) {
  const headers = { cookie: session.cookie, origin }
  if (method !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-csrf-token'] = session.csrfToken
  }
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

test('resolve enigma publicado por nome normalizado, abre partida idempotente e oculta respostas/dicas', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'O Enigma da Torre' })
  assert.equal(created.status, 201)
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'O Enigma da Torre',
    version: 1,
    steps: [
      { prompt: 'Primeira pista', answer: 'chave-secreta' },
      { prompt: 'Segunda pista', answer: 'segunda-chave' },
    ],
  })
  assert.equal(saved.status, 200)

  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  assert.equal(published.status, 200)

  const firstStepId = published.body.puzzle.steps[0].id
  const addedHint = await apiRequest(origin, author, `/api/author/steps/${firstStepId}/hints`, 'POST', {
    text: 'Dica oculta inicial',
    expectedVersion: published.body.puzzle.version,
  })
  assert.equal(addedHint.status, 201)

  const firstOpen = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', {
    name: '  o enigma da torre  ',
  })
  assert.equal(firstOpen.status, 200)
  assert.deepEqual(firstOpen.payload?.play ?? firstOpen.body.play, {
    puzzle: { id: puzzleId, name: 'O Enigma da Torre' },
    status: 'in_progress',
    version: 1,
    currentStep: {
      id: firstStepId,
      position: 1,
      prompt: 'Primeira pista',
      revealedHints: [],
      hasMoreHints: true,
    },
    finalMessage: null,
  })

  const serialized = JSON.stringify(firstOpen.body)
  assert.equal(serialized.includes('chave-secreta'), false)
  assert.equal(serialized.includes('Segunda pista'), false)
  assert.equal(serialized.includes('Dica oculta inicial'), false)

  const secondOpen = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', {
    name: 'O ENIGMA DA TORRE',
  })
  assert.equal(secondOpen.status, 200)
  assert.deepEqual(secondOpen.body.play, firstOpen.body.play)
})

test('trata rascunho, inexistente e excluído como indisponíveis', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const draftRes = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Ainda em Rascunho' })
  assert.equal(draftRes.status, 201)

  const openDraft = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Ainda em Rascunho' })
  assert.equal(openDraft.status, 404)
  assert.equal(openDraft.body.error.code, 'PUZZLE_UNAVAILABLE')

  const openMissing = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Enigma Que Nao Existe' })
  assert.equal(openMissing.status, 404)
  assert.equal(openMissing.body.error.code, 'PUZZLE_UNAVAILABLE')

  const toDelete = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Enigma Efemero' })
  const deleteId = toDelete.body.puzzle.id
  const saved = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}/draft`, 'PUT', {
    name: 'Enigma Efemero',
    version: 1,
    steps: [{ prompt: 'Pergunta', answer: 'resposta' }],
  })
  const pub = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const del = await apiRequest(origin, author, `/api/author/puzzles/${deleteId}`, 'DELETE', {
    confirmed: true,
    expectedVersion: pub.body.puzzle.version,
  })
  assert.equal(del.status, 200)

  const openDeleted = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Enigma Efemero' })
  assert.equal(openDeleted.status, 404)
  assert.equal(openDeleted.body.error.code, 'PUZZLE_UNAVAILABLE')
})

test('isola o progresso entre duas contas diferentes no mesmo enigma publicado', async (context) => {
  const { origin, accounts, database } = await setup(context)
  const author = await login(origin, 'autora')
  const playerA = await login(origin, 'jogadora1')
  const playerB = await login(origin, 'jogadora2')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Labirinto Compartilhado' })
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Labirinto Compartilhado',
    version: 1,
    steps: [
      { prompt: 'Etapa 1', answer: 'um' },
      { prompt: 'Etapa 2', answer: 'dois' },
    ],
  })
  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const [step1, step2] = published.body.puzzle.steps

  const openA = await apiRequest(origin, playerA, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  const openB = await apiRequest(origin, playerB, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  assert.equal(openA.status, 200)
  assert.equal(openB.status, 200)

  database.prepare(`
    UPDATE progress
    SET current_step_id = ?, version = version + 1
    WHERE puzzle_id = ? AND user_id = ?
  `).run(step2.id, puzzleId, accounts.jogadora1)

  const reopenA = await apiRequest(origin, playerA, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })
  const reopenB = await apiRequest(origin, playerB, '/api/play/puzzles/open', 'POST', { name: 'Labirinto Compartilhado' })

  assert.equal(reopenA.body.play.currentStep.id, step2.id)
  assert.equal(reopenA.body.play.version, 2)
  assert.equal(reopenB.body.play.currentStep.id, step1.id)
  assert.equal(reopenB.body.play.version, 1)
})

test('consulta etapa atual e conclusão sem expor respostas, outras etapas ou dicas ocultas (inclusive para o autor)', async (context) => {
  const { origin, accounts, database } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Cofre do Observatório' })
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Cofre do Observatório',
    version: 1,
    steps: [
      { prompt: 'Enunciado etapa 1', answer: 'segredo-um' },
      { prompt: 'Enunciado etapa 2', answer: 'segredo-dois' },
      { prompt: 'Enunciado etapa 3', answer: 'segredo-tres' },
    ],
  })
  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const [step1, step2] = published.body.puzzle.steps

  const withMessage = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/final-message`, 'PATCH', {
    finalMessage: 'Você decifrou o observatório.',
    expectedVersion: published.body.puzzle.version,
  })
  assert.equal(withMessage.status, 200)

  const h1 = await apiRequest(origin, author, `/api/author/steps/${step1.id}/hints`, 'POST', {
    text: 'Dica 1 visível',
    expectedVersion: withMessage.body.puzzle.version,
  })
  const h2 = await apiRequest(origin, author, `/api/author/steps/${step2.id}/hints`, 'POST', {
    text: 'Dica 2 revelada',
    expectedVersion: withMessage.body.puzzle.version + 1,
  })
  const h3 = await apiRequest(origin, author, `/api/author/steps/${step2.id}/hints`, 'POST', {
    text: 'Dica 2 oculta',
    expectedVersion: withMessage.body.puzzle.version + 2,
  })
  assert.equal(h1.status, 201)
  assert.equal(h2.status, 201)
  assert.equal(h3.status, 201)

  // Antes de abrir partida, GET retorna indisponível
  const beforeOpen = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}`)
  assert.equal(beforeOpen.status, 404)
  assert.equal(beforeOpen.body.error.code, 'PUZZLE_UNAVAILABLE')

  // Abre partida como jogadora e avança para etapa 2 com apenas a primeira dica da etapa 2 revelada
  const opened = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Cofre do Observatório' })
  assert.equal(opened.status, 200)

  const progressRow = database
    .prepare('SELECT id FROM progress WHERE user_id = ? AND puzzle_id = ?')
    .get(accounts.jogadora1, puzzleId)

  database.prepare('INSERT INTO hint_reveals (progress_id, hint_id) VALUES (?, ?)').run(progressRow.id, h1.body.hints[0].id)
  database.prepare('UPDATE progress SET current_step_id = ?, version = 2 WHERE id = ?').run(step2.id, progressRow.id)
  database.prepare('INSERT INTO hint_reveals (progress_id, hint_id) VALUES (?, ?)').run(progressRow.id, h2.body.hints[0].id)

  const midGame = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}`)
  assert.equal(midGame.status, 200)
  assert.deepEqual(midGame.body.play, {
    puzzle: { id: puzzleId, name: 'Cofre do Observatório' },
    status: 'in_progress',
    version: 2,
    currentStep: {
      id: step2.id,
      position: 2,
      prompt: 'Enunciado etapa 2',
      revealedHints: [{ id: h2.body.hints[0].id, position: 1, text: 'Dica 2 revelada' }],
      hasMoreHints: true,
    },
    finalMessage: null,
  })

  const midSerialized = JSON.stringify(midGame.body)
  for (const forbidden of [
    'segredo-um',
    'segredo-dois',
    'segredo-tres',
    'Enunciado etapa 1',
    'Enunciado etapa 3',
    'Dica 1 visível',
    'Dica 2 oculta',
    'Você decifrou o observatório.',
  ]) {
    assert.equal(midSerialized.includes(forbidden), false)
  }

  // O próprio autor jogando recebe exatamente o mesmo DTO restrito, sem respostas ou dicas ocultas
  const authorOpen = await apiRequest(origin, author, '/api/play/puzzles/open', 'POST', { name: 'Cofre do Observatório' })
  assert.equal(authorOpen.status, 200)
  const authorRead = await apiRequest(origin, author, `/api/play/puzzles/${puzzleId}`)
  assert.equal(authorRead.status, 200)
  assert.deepEqual(authorRead.body.play, {
    puzzle: { id: puzzleId, name: 'Cofre do Observatório' },
    status: 'in_progress',
    version: 1,
    currentStep: {
      id: step1.id,
      position: 1,
      prompt: 'Enunciado etapa 1',
      revealedHints: [],
      hasMoreHints: true,
    },
    finalMessage: null,
  })
  const authorSerialized = JSON.stringify(authorRead.body)
  assert.equal(authorSerialized.includes('segredo-um'), false)
  assert.equal(authorSerialized.includes('Dica 1 visível'), false)
  assert.equal(authorSerialized.includes('Enunciado etapa 2'), false)

  // Conclui a partida da jogadora e consulta o DTO final
  database.prepare('UPDATE progress SET current_step_id = NULL, completed_at = CURRENT_TIMESTAMP, version = 4 WHERE id = ?').run(progressRow.id)

  const finished = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}`)
  assert.equal(finished.status, 200)
  assert.deepEqual(finished.body.play, {
    puzzle: { id: puzzleId, name: 'Cofre do Observatório' },
    status: 'completed',
    version: 4,
    currentStep: null,
    finalMessage: 'Você decifrou o observatório.',
  })
  const finishedSerialized = JSON.stringify(finished.body)
  assert.equal(finishedSerialized.includes('segredo-tres'), false)
  assert.equal(finishedSerialized.includes('Enunciado etapa 2'), false)
})

test('valida respostas, avança e conclui de forma transacional e bloqueia somente a resposta da etapa após o primeiro acerto', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player1 = await login(origin, 'jogadora1')
  const player2 = await login(origin, 'jogadora2')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Relógio de Areia' })
  const puzzleId = created.body.puzzle.id

  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Relógio de Areia',
    version: 1,
    steps: [
      { prompt: 'Primeira charada', answer: 'sol' },
      { prompt: 'Segunda charada', answer: 'lua' },
    ],
  })
  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const [step1, step2] = published.body.puzzle.steps

  const withMsg = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/final-message`, 'PATCH', {
    finalMessage: 'Tempo concluído!',
    expectedVersion: published.body.puzzle.version,
  })

  const hintStep1 = await apiRequest(origin, author, `/api/author/steps/${step1.id}/hints`, 'POST', {
    text: 'Dica da primeira charada',
    expectedVersion: withMsg.body.puzzle.version,
  })
  assert.equal(hintStep1.status, 201)

  // Autor altera a resposta da etapa 1 antes de qualquer acerto
  const editedBeforeSolve = await apiRequest(origin, author, `/api/author/steps/${step1.id}/content`, 'PATCH', {
    prompt: 'Primeira charada revisada',
    answer: 'estrela',
    expectedVersion: withMsg.body.puzzle.version + 1,
  })
  assert.equal(editedBeforeSolve.status, 200)

  const open1 = await apiRequest(origin, player1, '/api/play/puzzles/open', 'POST', { name: 'Relógio de Areia' })
  assert.equal(open1.status, 200)

  // Resposta antiga e resposta incorreta não avançam nem alteram versão
  const oldAnswer = await apiRequest(origin, player1, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step1.id,
    expectedVersion: 1,
    answer: 'sol',
  })
  assert.equal(oldAnswer.status, 200)
  assert.equal(oldAnswer.body.correct, false)
  assert.equal(oldAnswer.body.play.currentStep.id, step1.id)
  assert.equal(oldAnswer.body.play.version, 1)

  // Resposta vigente (normalizada) avança para etapa 2 e registra primeiro acerto global da etapa 1
  const rightStep1 = await apiRequest(origin, player1, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step1.id,
    expectedVersion: 1,
    answer: '  ESTRELA  ',
  })
  assert.equal(rightStep1.status, 200)
  assert.equal(rightStep1.body.correct, true)
  assert.equal(rightStep1.body.play.status, 'in_progress')
  assert.equal(rightStep1.body.play.currentStep.id, step2.id)
  assert.equal(rightStep1.body.play.currentStep.position, 2)
  assert.equal(rightStep1.body.play.version, 2)

  // Após o primeiro acerto global na etapa 1:
  // 1) autor ainda edita enunciado da etapa 1 e resposta da etapa 2, mas resposta da etapa 1 permanece congelada
  const authorAfterSolve = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}`)
  assert.ok(authorAfterSolve.body.puzzle.steps[0].first_solved_at)
  assert.equal(authorAfterSolve.body.puzzle.steps[1].first_solved_at, null)

  const editStep1AfterSolve = await apiRequest(origin, author, `/api/author/steps/${step1.id}/content`, 'PATCH', {
    prompt: 'Primeira charada pós-acerto',
    answer: 'cometa',
    expectedVersion: authorAfterSolve.body.puzzle.version,
  })
  assert.equal(editStep1AfterSolve.status, 200)
  assert.equal(editStep1AfterSolve.body.puzzle.steps[0].prompt, 'Primeira charada pós-acerto')
  assert.equal(editStep1AfterSolve.body.puzzle.steps[0].answer_text, 'estrela')

  const editStep2BeforeSolve = await apiRequest(origin, author, `/api/author/steps/${step2.id}/content`, 'PATCH', {
    prompt: 'Segunda charada revisada',
    answer: 'aurora',
    expectedVersion: editStep1AfterSolve.body.puzzle.version,
  })
  assert.equal(editStep2BeforeSolve.status, 200)
  assert.equal(editStep2BeforeSolve.body.puzzle.steps[1].answer_text, 'aurora')

  // Jogadora 2 ainda resolve a etapa 1 com 'estrela'
  await apiRequest(origin, player2, '/api/play/puzzles/open', 'POST', { name: 'Relógio de Areia' })
  const p2Step1 = await apiRequest(origin, player2, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step1.id,
    expectedVersion: 1,
    answer: 'estrela',
  })
  assert.equal(p2Step1.body.correct, true)
  assert.equal(p2Step1.body.play.currentStep.id, step2.id)

  // Jogadora 1 conclui o enigma na última etapa
  const finishP1 = await apiRequest(origin, player1, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step2.id,
    expectedVersion: 2,
    answer: 'aurora',
  })
  assert.equal(finishP1.status, 200)
  assert.equal(finishP1.body.correct, true)
  assert.equal(finishP1.body.play.status, 'completed')
  assert.equal(finishP1.body.play.currentStep, null)
  assert.equal(finishP1.body.play.finalMessage, 'Tempo concluído!')
  assert.equal(finishP1.body.play.version, 3)

  // Novo envio após conclusão retorna 409 STALE_PROGRESS
  const afterComplete = await apiRequest(origin, player1, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step2.id,
    expectedVersion: 3,
    answer: 'aurora',
  })
  assert.equal(afterComplete.status, 409)
  assert.equal(afterComplete.body.error.code, 'STALE_PROGRESS')
})

test('impede avanço duplicado em duplo clique/retry, duas abas e etapas consecutivas com a mesma resposta, permitindo recarga após STALE_PROGRESS', async (context) => {
  const { origin } = await setup(context)
  const author = await login(origin, 'autora')
  const player = await login(origin, 'jogadora1')

  const created = await apiRequest(origin, author, '/api/author/puzzles', 'POST', { name: 'Ecos Idênticos' })
  const puzzleId = created.body.puzzle.id

  // Três etapas consecutivas com a exata mesma resposta ("eco")
  const saved = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/draft`, 'PUT', {
    name: 'Ecos Idênticos',
    version: 1,
    steps: [
      { prompt: 'Primeiro eco', answer: 'eco' },
      { prompt: 'Segundo eco', answer: 'eco' },
      { prompt: 'Terceiro eco', answer: 'eco' },
    ],
  })
  const published = await apiRequest(origin, author, `/api/author/puzzles/${puzzleId}/publish`, 'POST', {
    expectedVersion: saved.body.puzzle.version,
  })
  const [step1, step2, step3] = published.body.puzzle.steps

  const opened = await apiRequest(origin, player, '/api/play/puzzles/open', 'POST', { name: 'Ecos Idênticos' })
  assert.equal(opened.status, 200)
  assert.equal(opened.body.play.currentStep.id, step1.id)
  assert.equal(opened.body.play.version, 1)

  // Duplo clique / retry concorrente enviando o mesmo (stepId, expectedVersion) duas vezes
  const [firstClick, duplicateClick] = await Promise.all([
    apiRequest(origin, player, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
      stepId: step1.id,
      expectedVersion: 1,
      answer: 'eco',
    }),
    apiRequest(origin, player, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
      stepId: step1.id,
      expectedVersion: 1,
      answer: 'eco',
    }),
  ])

  const responses = [firstClick, duplicateClick]
  const succeeded = responses.find((r) => r.status === 200)
  const stale = responses.find((r) => r.status === 409)

  assert.ok(succeeded)
  assert.ok(stale)
  assert.equal(succeeded.body.correct, true)
  assert.equal(succeeded.body.play.currentStep.id, step2.id)
  assert.equal(succeeded.body.play.version, 2)

  assert.equal(stale.body.error.code, 'STALE_PROGRESS')
  assert.equal(stale.body.play.currentStep.id, step2.id)
  assert.equal(stale.body.play.version, 2)

  // Segunda aba desatualizada tenta enviar para step1 (version 1) e recebe STALE_PROGRESS sem pular step2
  const secondTabStale = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: step1.id,
    expectedVersion: 1,
    answer: 'eco',
  })
  assert.equal(secondTabStale.status, 409)
  assert.equal(secondTabStale.body.error.code, 'STALE_PROGRESS')

  // Recarrega o estado atual e avança legitimamente da etapa 2 para a etapa 3
  const reloaded = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}`)
  assert.equal(reloaded.status, 200)
  assert.equal(reloaded.body.play.currentStep.id, step2.id)
  assert.equal(reloaded.body.play.version, 2)

  const advanceToStep3 = await apiRequest(origin, player, `/api/play/puzzles/${puzzleId}/answer`, 'POST', {
    stepId: reloaded.body.play.currentStep.id,
    expectedVersion: reloaded.body.play.version,
    answer: 'eco',
  })
  assert.equal(advanceToStep3.status, 200)
  assert.equal(advanceToStep3.body.correct, true)
  assert.equal(advanceToStep3.body.play.currentStep.id, step3.id)
  assert.equal(advanceToStep3.body.play.version, 3)
})