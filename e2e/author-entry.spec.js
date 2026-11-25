import { expect, test } from '@playwright/test'
import { startNexoHttps } from './https-server.js'

const password = 'senha descartavel rota direta'

async function submit(field, value) {
  await field.fill(value)
  await field.press('Enter')
}

async function signup(page, username) {
  await submit(page.getByLabel('Quem você é?', { exact: true }), username)
  await submit(page.getByLabel('Não conhecemos você. Novo por aqui? (y/n)', { exact: true }), 'y')
  await submit(page.getByLabel('Qual é a senha?', { exact: true }), password)
}

test('destinos diretos de autoria exigem sessão e preservam o editor quando sair falha', async ({ browser }) => {
  const nexo = await startNexoHttps()
  let context
  try {
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    const authorRequests = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/author/')) authorRequests.push(request.url())
    })
    await page.goto(nexo.origin + '/nexo/novo')
    await expect(page.getByLabel('Quem você é?', { exact: true })).toBeFocused()
    expect(authorRequests).toEqual([])
    await signup(page, 'Autora do acesso direto')
    const name = page.getByLabel('Nome do enigma', { exact: true })
    await expect(name).toHaveValue('')
    const initialList = await page.request.get(nexo.origin + '/api/author/puzzles')
    expect((await initialList.json()).puzzles).toEqual([])

    await name.fill('Rascunho de acesso direto')
    await page.getByRole('button', { name: 'Adicionar etapa', exact: true }).click()
    await page.getByLabel('Enunciado', { exact: true }).fill('Conteúdo privado do rascunho.')
    await page.getByLabel('Resposta correta', { exact: true }).fill('resposta privada do rascunho')
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible()
    const list = await page.request.get(nexo.origin + '/api/author/puzzles')
    const [puzzle] = (await list.json()).puzzles
    const editorUrl = nexo.origin + '/nexo/' + puzzle.id
    await expect(page).toHaveURL(editorUrl)
    await page.goto(nexo.origin + '/nexo')
    await expect(page.getByRole('heading', { name: 'Seus enigmas' })).toBeVisible()
    await expect(page.getByText('Rascunho de acesso direto', { exact: true })).toBeVisible()
    await page.goto(editorUrl)
    await expect(page.getByLabel('Resposta correta', { exact: true })).toHaveValue('resposta privada do rascunho')

    const prompt = page.getByLabel('Enunciado', { exact: true })
    const openList = page.getByRole('button', { name: 'Voltar à lista', exact: true })
    await test.step('volta à lista após identificar a mesma conta com edição pendente', async () => {
      await context.clearCookies()
      await prompt.fill('Alteração preservada após identificar.')
      await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
      await submit(page.getByLabel('Quem você é?', { exact: true }), 'Autora do acesso direto')
      await submit(page.getByLabel('Qual é a senha?', { exact: true }), password)
      await expect(prompt).toHaveValue('Alteração preservada após identificar.')
      page.once('dialog', (dialog) => dialog.accept())
      await openList.click()
      await expect(page.getByText('Rascunho de acesso direto', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(nexo.origin + '/nexo')
    })

    await test.step('criar um rascunho cancela a abertura que ainda está em curso', async () => {
      const intercepted = Promise.withResolvers()
      const release = Promise.withResolvers()
      await page.route('**/api/author/puzzles/' + puzzle.id, async (route) => {
        intercepted.resolve()
        await release.promise
        await route.continue()
      }, { times: 1 })
      try {
        await page.goto(editorUrl)
        await intercepted.promise
        await page.getByRole('button', { name: 'Criar um novo nexo', exact: true }).click()
        await expect(name).toHaveValue('')
        await openList.click()
      } finally {
        release.resolve()
      }
      await expect(page.getByText('Rascunho de acesso direto', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(nexo.origin + '/nexo')
    })

    await page.goto(editorUrl)
    await prompt.fill('Alteração local em andamento.')
    await page.route('**/api/auth/logout', (route) => route.abort(), { times: 1 })
    const logout = page.getByRole('button', { name: 'Sair', exact: true })
    page.once('dialog', (dialog) => dialog.accept())
    await logout.click()
    await expect(page.getByRole('alert')).toHaveText('Não foi possível encerrar a sessão. Tente novamente.')
    await expect(prompt).toHaveValue('Alteração local em andamento.')
    await expect(page).toHaveURL(editorUrl)
    const active = await page.request.get(nexo.origin + '/api/auth/session')
    expect((await active.json()).user.usernameDisplay).toBe('Autora do acesso direto')

    page.once('dialog', (dialog) => dialog.accept())
    await logout.click()
    await expect(page.getByRole('status').filter({ hasText: 'Sessão encerrada.' })).toBeVisible()
    await expect(page).toHaveURL(nexo.origin + '/')
    const anonymous = await page.request.get(nexo.origin + '/api/auth/session')
    expect((await anonymous.json()).user).toBeNull()

    const previousRequests = authorRequests.length
    await page.goto(editorUrl)
    await expect(page.getByLabel('Quem você é?', { exact: true })).toBeFocused()
    expect(authorRequests).toHaveLength(previousRequests)
    const denied = page.waitForResponse((response) => response.url() === nexo.origin + '/api/author/puzzles/' + puzzle.id)
    await signup(page, 'Outra conta direta')
    const blocked = await denied
    expect(blocked.status()).toBe(404)
    expect(await blocked.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Enigma não encontrado.' } })
    await expect(page.getByText('Você ainda não tem enigmas salvos.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Resposta correta', { exact: true })).toHaveCount(0)
  } finally {
    try {
      await context?.close()
    } finally {
      await nexo.close()
    }
  }
})
