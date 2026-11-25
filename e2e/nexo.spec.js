import { expect, test } from '@playwright/test'
import { startNexoHttps } from './https-server.js'

const puzzleName = 'Arquivo das Lanternas'
const password = 'senha descartavel do teste'
const firstPrompt = 'Observe as marcas na parede.'
const secondPrompt = 'Encontre a última lanterna.'
const hint = 'Conte as marcas perto da saída.'
const finalMessage = 'Todas as lanternas foram acesas.'

function entry(page) {
  return page.getByLabel('O que você busca?', { exact: true })
}

function step(page, position) {
  return page.getByRole('group', { name: 'Etapa ' + position, exact: true })
}

async function enter(field, value) {
  await field.fill(value)
  await field.press('Enter')
}

async function openHome(page, origin) {
  const session = page.waitForResponse((response) => response.url() === origin + '/api/auth/session' && response.ok())
  await page.goto(origin)
  await session
}

async function identify(page, username, destination, register = false) {
  await enter(entry(page), destination)
  await enter(page.getByLabel('Quem você é?', { exact: true }), username)
  if (register) {
    await enter(page.getByLabel('Não conhecemos você. Novo por aqui? (y/n)', { exact: true }), 'y')
  }
  await enter(page.getByLabel('Qual é a senha?', { exact: true }), password)
}

async function logout(page, origin) {
  const anonymous = page.waitForResponse(async (response) => {
    if (response.url() !== origin + '/api/auth/session' || !response.ok()) return false
    return (await response.json()).user === null
  })
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await anonymous
  await expect(entry(page)).toBeFocused()
}

async function expectSecureSession(page, origin, username) {
  const cookie = (await page.context().cookies(origin)).find((item) => item.name === 'nexo.sid')
  expect(cookie?.secure).toBe(true)
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')
  const response = await page.request.get(origin + '/api/auth/session')
  expect(response.ok()).toBe(true)
  expect((await response.json()).user.usernameDisplay).toBe(username)
}

async function confirm(button, expectedMessage) {
  const page = button.page()
  const dialog = page.waitForEvent('dialog')
  const click = button.click()
  const confirmation = await dialog
  const message = confirmation.message()
  await confirmation.accept()
  await click
  expect(message).toMatch(expectedMessage)
}

test('autora e jogadora percorrem o Nexo em HTTPS com duas contas', async ({ browser }) => {
  test.setTimeout(60_000)

  const nexo = await startNexoHttps()
  let authorContext
  try {
    authorContext = await browser.newContext({ ignoreHTTPSErrors: true })
    const author = await authorContext.newPage()
    const playerContext = await browser.newContext({ ignoreHTTPSErrors: true })
    try {
      const player = await playerContext.newPage()

      await test.step('Criar, salvar e retomar um rascunho', async () => {
        await openHome(author, nexo.origin)
        await identify(author, 'Autora E2E', 'acessar o nexo', true)
        await expect(author.getByRole('heading', { name: 'Seus enigmas' })).toBeVisible()
        await expectSecureSession(author, nexo.origin, 'Autora E2E')
        await author.getByRole('button', { name: 'Criar um novo nexo' }).click()
        await author.getByLabel('Nome do enigma', { exact: true }).fill(puzzleName)
        await author.getByRole('button', { name: 'Adicionar etapa', exact: true }).click()
        await step(author, 1).getByLabel('Enunciado', { exact: true }).fill(firstPrompt)
        await step(author, 1).getByLabel('Resposta correta', { exact: true }).fill('marcas')
        await step(author, 1).getByRole('button', { name: 'Adicionar dica', exact: true }).click()
        await step(author, 1).getByLabel('Dica 1', { exact: true }).fill(hint)
        await author.getByRole('button', { name: 'Adicionar etapa', exact: true }).click()
        await step(author, 2).getByLabel('Enunciado', { exact: true }).fill(secondPrompt)
        await step(author, 2).getByLabel('Resposta correta', { exact: true }).fill('lanterna')
        await author.getByLabel('Mensagem final (opcional)', { exact: true }).fill(finalMessage)
        await author.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
        await expect(author.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible()

        await logout(author, nexo.origin)
        await identify(author, 'Autora E2E', 'acessar o nexo')
        await author.getByRole('button', { name: 'Continuar rascunho', exact: true }).click()
        await expect(author.getByLabel('Nome do enigma', { exact: true })).toHaveValue(puzzleName)
        await expect(step(author, 1).getByLabel('Dica 1', { exact: true })).toHaveValue(hint)
        await expect(step(author, 2).getByLabel('Enunciado', { exact: true })).toHaveValue(secondPrompt)
        await expect(author.getByLabel('Mensagem final (opcional)', { exact: true })).toHaveValue(finalMessage)
      })

      await test.step('Publicar e retomar uma dica em outra conta', async () => {
        await openHome(player, nexo.origin)
        await identify(player, 'Jogadora E2E', puzzleName, true)
        await expect(player.getByRole('alert')).toHaveText('Não encontramos esse nexo.')
        await expectSecureSession(player, nexo.origin, 'Jogadora E2E')

        await confirm(author.getByRole('button', { name: 'Publicar enigma', exact: true }), /nome, a quantidade e a ordem das etapas ficam fixos/)
        await expect(author.getByText('Enigma publicado.', { exact: false })).toBeVisible()

        await enter(entry(player), puzzleName)
        await expect(player.getByText(firstPrompt, { exact: true })).toBeVisible()
        await expect(player.getByText(secondPrompt, { exact: true })).toHaveCount(0)
        await expect(player.getByText(hint, { exact: false })).toHaveCount(0)
        const answer = player.getByLabel('Resposta', { exact: true })
        await enter(answer, '/dica')
        await expect(player.getByText('Dica 1: ' + hint, { exact: true })).toBeVisible()

        await enter(answer, '/inicio')
        await logout(player, nexo.origin)
        await identify(player, 'Jogadora E2E', puzzleName)
        await expect(player.getByText('Dica 1: ' + hint, { exact: true })).toBeVisible()
        await expectSecureSession(player, nexo.origin, 'Jogadora E2E')
      })

      await test.step('Avançar e aplicar o bloqueio da resposta no editor', async () => {
        const answer = player.getByLabel('Resposta', { exact: true })
        await enter(answer, 'resposta incorreta do teste')
        await expect(player.getByRole('alert')).toHaveText('Resposta incorreta. Tente novamente.')
        await expect(player.getByText(firstPrompt, { exact: true })).toBeVisible()
        await enter(answer, 'marcas')
        await expect(player.getByText(secondPrompt, { exact: true })).toBeVisible()
        await expect(player.getByText(firstPrompt, { exact: true })).toHaveCount(0)
        await expect(player.getByText('Dica 1: ' + hint, { exact: true })).toHaveCount(0)

        const firstAnswer = step(author, 1).getByLabel('Resposta correta', { exact: true })
        await firstAnswer.fill('tentativa de mudança')
        await step(author, 1).getByRole('button', { name: 'Salvar etapa', exact: true }).click()
        await expect(author.getByRole('alert')).toContainText('O recurso foi alterado desde a última leitura.')
        await confirm(author.getByRole('button', { name: 'Recarregar versão atual', exact: true }), /alterações desde o último salvamento/)
        await expect(firstAnswer).toHaveValue('marcas')
        await expect(firstAnswer).toHaveAttribute('readonly', '')
        await expect(step(author, 2).getByLabel('Resposta correta', { exact: true })).toBeEditable()
        await step(author, 1).getByLabel('Enunciado', { exact: true }).fill('Observe com atenção as marcas na parede.')
        await step(author, 1).getByRole('button', { name: 'Salvar etapa', exact: true }).click()
        await expect(author.getByRole('status').filter({ hasText: 'Etapa salva.' })).toBeVisible()
      })

      await test.step('Concluir, reabrir e excluir o enigma', async () => {
        await enter(player.getByLabel('Resposta', { exact: true }), 'lanterna')
        await expect(player.getByText(finalMessage, { exact: true })).toBeVisible()
        await player.getByRole('button', { name: 'Início', exact: true }).click()
        await enter(entry(player), puzzleName)
        await expect(player.getByText(finalMessage, { exact: true })).toBeVisible()

        await author.getByRole('button', { name: 'Recarregar versão atual', exact: true }).click()
        await expect(step(author, 2).getByLabel('Resposta correta', { exact: true })).toHaveAttribute('readonly', '')
        await confirm(author.getByRole('button', { name: 'Excluir enigma', exact: true }), /todo o progresso dos jogadores/)
        await expect(author.getByRole('status').filter({ hasText: 'Enigma excluído.' })).toBeVisible()
        await player.getByRole('button', { name: 'Atualizar mensagem', exact: true }).click()
        await expect(player.getByRole('alert')).toHaveText('Não encontramos esse nexo.')
        await expect(player.getByText(finalMessage, { exact: true })).toHaveCount(0)
      })
    } finally {
      await playerContext.close()
    }
  } finally {
    try {
      await authorContext?.close()
    } finally {
      await nexo.close()
    }
  }
})
