import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const production = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 3000)
const buildDirectory = production ? fileURLToPath(new URL('../../web/dist/', import.meta.url)) : undefined
const app = createApp({ buildDirectory })

app.listen(port, () => {
  console.log(`Nexo disponível na porta ${port}`)
})
