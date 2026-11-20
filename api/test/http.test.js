import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.js'

test('Express serve a SPA para navegação HTML e mantém respostas de API em JSON', async (context) => {
  const buildDirectory = mkdtempSync(join(tmpdir(), 'nexo-http-'))
  writeFileSync(join(buildDirectory, 'index.html'), '<h1>Nexo</h1>')
  writeFileSync(join(buildDirectory, 'main.js'), 'export {}')

  const server = createApp({ buildDirectory }).listen(0, '127.0.0.1')
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(buildDirectory, { recursive: true, force: true })
  })
  await once(server, 'listening')

  const origin = `http://127.0.0.1:${server.address().port}`
  const html = { Accept: 'text/html' }

  const health = await fetch(origin + '/api/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const unknownApi = await fetch(origin + '/api/inexistente', { headers: html })
  assert.equal(unknownApi.status, 404)
  assert.deepEqual(await unknownApi.json(), { error: 'NOT_FOUND' })

  const navigation = await fetch(origin + '/criadores', { headers: html })
  assert.equal(navigation.status, 200)
  assert.match(await navigation.text(), /<h1>Nexo<\/h1>/)

  const head = await fetch(origin + '/criadores', { method: 'HEAD', headers: html })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  for (const accept of ['application/json', '*/*', 'text/html;q=0, */*;q=1']) {
    const nonNavigation = await fetch(origin + '/criadores', { headers: { Accept: accept } })
    assert.equal(nonNavigation.status, 404)
  }

  const post = await fetch(origin + '/criadores', { method: 'POST', headers: html })
  assert.equal(post.status, 404)

  const asset = await fetch(origin + '/main.js')
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), 'export {}')
})
