import { expect, test } from '@playwright/test'
import { startNexoHttps } from './https-server.js'

const name = 'Percurso de inspeção'
const password = 'senha descartavel de teste'
const firstPrompt = '<strong>Leia estas marcas como texto.</strong>'
const futurePrompt = 'Enunciado exclusivo da segunda etapa.'
const firstHint = 'Este texto só aparece após pedir a primeira dica.'
const futureHint = 'Esta dica pertence à etapa futura.'
const firstAnswer = 'resposta-secreta-etapa-1'
const futureAnswer = 'resposta-secreta-etapa-2'
const finalMessage = 'Esta mensagem só aparece na conclusão.'
const puzzleMarkers = [firstPrompt, futurePrompt, firstHint, futureHint, firstAnswer, futureAnswer, finalMessage]

async function seedPuzzle(request, origin) {
  const api = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true, extraHTTPHeaders: { Origin: origin } })
  try {
    const session = await api.get('/api/auth/session')
    expect(session.ok()).toBe(true)
    const { csrfToken } = await session.json()
    const registration = await api.post('/api/auth/register', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { username: 'Autora da inspeção', password, confirmedNew: true },
    })
    expect(registration.status()).toBe(201)
    const headers = { 'X-CSRF-Token': (await registration.json()).csrfToken }
    const draft = await api.post('/api/author/puzzles', {
      headers,
      data: {
        name,
        finalMessage,
        steps: [
          { prompt: firstPrompt, answer: firstAnswer, hints: [{ text: firstHint }] },
          { prompt: futurePrompt, answer: futureAnswer, hints: [{ text: futureHint }] },
        ],
      },
    })
    expect(draft.status()).toBe(201)
    const { puzzle } = await draft.json()
    const publish = await api.post('/api/author/puzzles/' + puzzle.id + '/publish', {
      headers, data: { expectedVersion: puzzle.version },
    })
    expect(publish.ok()).toBe(true)
    return puzzle
  } finally {
    await api.dispose()
  }
}

async function enter(field, text) {
  await field.fill(text)
  await field.press('Enter')
}

function luminance(rgb) {
  const channels = rgb.match(/\d+/g).slice(0, 3).map((channel) => Number(channel) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

async function contrast(locator, property = 'color', backdrop = 'main') {
  const [ink, background] = await locator.evaluate((element, options) => [
    getComputedStyle(element)[options.property],
    getComputedStyle(options.backdrop ? element.closest(options.backdrop) : element).backgroundColor,
  ], { property, backdrop })
  const first = luminance(ink)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

async function expectVisibleFocus(field, indicator) {
  await expect(field).toBeFocused()
  await expect(indicator).toHaveCSS('outline-style', 'solid')
  await expect(indicator).toHaveCSS('outline-width', '2px')
  expect(await contrast(indicator, 'outlineColor')).toBeGreaterThanOrEqual(3)
}

function expectReleasedSnapshot(snapshot, puzzle, index, shownHints = []) {
  const step = puzzle.steps[index]
  expect(snapshot).toEqual({
    puzzle: { id: puzzle.id, name },
    status: step ? 'in_progress' : 'completed',
    version: expect.any(Number),
    currentStep: step ? {
      id: step.id,
      position: index + 1,
      prompt: step.prompt,
      revealedHints: shownHints,
      hasMoreHints: step.hints.length > shownHints.length,
    } : null,
    finalMessage: step ? null : finalMessage,
  })
}

const profiles = [
  { label: 'desktop 1280 px', width: 1280, mobile: false },
  { label: 'celular emulado 320 px', width: 320, mobile: true },
]

for (const { label, width, mobile } of profiles) {
  test('audita acesso e conteúdo liberado em ' + label, async ({ browser, playwright }) => {
    test.setTimeout(60_000)
    const nexo = await startNexoHttps()
    let context
    try {
      const puzzle = await seedPuzzle(playwright.request, nexo.origin)
      context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width, height: 800 },
        isMobile: mobile,
        hasTouch: mobile,
      })
      const page = await context.newPage()
      const paths = []
      const scripts = []
      page.on('request', (request) => paths.push(new URL(request.url()).pathname))
      page.on('response', (response) => {
        if (response.url().startsWith(nexo.origin + '/assets/') && response.request().resourceType() === 'script') {
          scripts.push(response)
        }
      })
      const session = page.waitForResponse((response) => response.url() === nexo.origin + '/api/auth/session' && response.ok())
      await page.goto(nexo.origin)
      await session

      const screen = page.getByRole('main')
      const field = page.getByLabel('O que você busca?', { exact: true })
      const prompt = page.locator('label[for="entry-intent"]')
      const inputFrame = page.locator('.nexo-input-row')
      await expect(screen).toHaveText(/^O que você busca\?\s*>$/)
      await expect(screen.locator('button, a')).toHaveCount(0)
      await expectVisibleFocus(field, inputFrame)
      expect(paths.filter((path) => /^\/api\/(play|author)\//.test(path))).toEqual([])
      const metrics = {
        pergunta: await contrast(prompt),
        campo: await contrast(field, 'color', '.nexo-input-row'),
        foco: await contrast(inputFrame, 'outlineColor'),
      }

      await enter(field, name)
      const username = page.getByLabel('Quem você é?', { exact: true })
      await expectVisibleFocus(username, inputFrame)
      await username.press('Tab')
      await expectVisibleFocus(page.getByRole('button', { name: 'Continuar' }), page.getByRole('button', { name: 'Continuar' }))
      await page.keyboard.press('Shift+Tab')
      await expect(username).toBeFocused()
      await enter(username, 'a'.repeat(65))
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('64 caracteres')
      await expect(username).toBeFocused()
      metrics.erro = await contrast(alert)

      await enter(username, 'Jogadora da inspeção')
      const choice = page.getByLabel('Não conhecemos você. Novo por aqui? (y/n)', { exact: true })
      const notice = page.getByText('Guarde sua senha. O Nexo não oferece recuperação de acesso.')
      await expect(notice).toBeVisible()
      metrics.aviso = await contrast(notice)
      await enter(choice, 'y')
      const passwordField = page.getByLabel('Qual é a senha?', { exact: true })
      await expect(passwordField).toBeFocused()
      let releaseRegistration
      const registrationGate = new Promise((resolve) => { releaseRegistration = resolve })
      await page.route('**/api/auth/register', async (route) => {
        await registrationGate
        await route.continue()
      }, { times: 1 })
      const opened = page.waitForResponse((response) => response.url().endsWith('/play/puzzles/open') && response.ok())
      try {
        await enter(passwordField, password)
        const waiting = page.getByRole('status').filter({ hasText: 'Verificando…' })
        await expect(waiting).toBeVisible()
        metrics.estado = await contrast(waiting)
        await expect(passwordField).toBeFocused()
        await expect(passwordField).toHaveAttribute('readonly', '')
      } finally {
        releaseRegistration()
      }
      expectReleasedSnapshot((await (await opened).json()).play, puzzle, 0)

      await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible()
      await expect(screen.locator('strong')).toHaveCount(0)
      await expect(screen.getByText(futurePrompt, { exact: true })).toHaveCount(0)
      await expect(screen.getByText(firstHint, { exact: false })).toHaveCount(0)
      const answer = page.getByLabel('Resposta', { exact: true })
      await expectVisibleFocus(answer, inputFrame)
      const send = page.getByRole('button', { name: 'Enviar', exact: true })
      const hintButton = page.getByRole('button', { name: 'Pedir dica' })
      const start = page.getByRole('button', { name: 'Início', exact: true })
      await answer.press('Tab')
      await expectVisibleFocus(send, send)
      metrics.botao = await contrast(send, 'color', null)
      metrics.borda = Math.min(
        await contrast(inputFrame, 'borderTopColor', null),
        await contrast(inputFrame, 'borderTopColor'),
      )
      await page.keyboard.press('Tab')
      await expectVisibleFocus(hintButton, hintButton)
      await page.keyboard.press('Tab')
      await expect(start).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(start).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(hintButton).toBeFocused()
      const reveal = page.waitForResponse((response) => response.url().endsWith('/hints/reveal') && response.ok())
      await page.keyboard.press('Enter')
      const { play } = await (await reveal).json()
      expectReleasedSnapshot(play, puzzle, 0, puzzle.steps[0].hints)
      await expect(page.getByText('Dica 1: ' + firstHint, { exact: true })).toBeVisible()
      await expect(hintButton).toHaveCount(0)
      await expect(answer).toBeFocused()

      const advance = page.waitForResponse((response) => response.url().endsWith('/answer') && response.ok())
      await enter(answer, firstAnswer)
      const advanced = await advance
      expect(advanced.request().postDataJSON()).toEqual({
        answer: firstAnswer, expectedVersion: play.version, stepId: puzzle.steps[0].id,
      })
      expectReleasedSnapshot((await advanced.json()).play, puzzle, 1)
      await expect(page.getByText(futurePrompt, { exact: true })).toBeVisible()
      await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(0)
      await expect(page.getByText(futureHint, { exact: false })).toHaveCount(0)
      await expect(answer).toBeFocused()
      expect(await page.evaluate(() => ({
        viewport: innerWidth,
        horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }))).toEqual({ viewport: width, horizontalScroll: false })

      const finish = page.waitForResponse((response) => response.url().endsWith('/answer') && response.ok())
      await enter(answer, futureAnswer)
      expectReleasedSnapshot((await (await finish).json()).play, puzzle, 2)
      await expect(page.getByText(finalMessage, { exact: true })).toBeVisible()
      await expectVisibleFocus(start, start)
      await start.press('Enter')
      await expectVisibleFocus(field, inputFrame)
      expect(paths.filter((path) => path.startsWith('/api/author/'))).toEqual([])
      expect(scripts.length).toBeGreaterThan(0)
      const downloaded = (await Promise.all(scripts.map((response) => response.text()))).join('')
      for (const marker of puzzleMarkers) expect(downloaded).not.toContain(marker)
      for (const [role, ratio] of Object.entries(metrics)) {
        const minimum = role === 'foco' || role === 'borda' ? 3 : 4.5
        expect(ratio, 'contraste de ' + role).toBeGreaterThanOrEqual(minimum)
      }
      console.log(label + ' — contraste: ' + Object.entries(metrics).map(([role, ratio]) => role + ' ' + ratio.toFixed(2)).join(', '))
    } finally {
      try {
        await context?.close()
      } finally {
        await nexo.close()
      }
    }
  })
}
