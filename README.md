# Nexo

Plataforma de enigmas textuais com interface de terminal.

## Executar a base local

Use Node.js 24 LTS. Na raiz do repositório:

```powershell
npm ci
npm run dev
```

Abra o endereço exibido pelo Vite. A tela inicial exibe “O que você busca?”.

Em outro terminal, rode `npm run dev:api`. O Vite encaminha `/api` para o Express na porta 3000. Acesse `http://localhost:5173/api/health` usando a porta mostrada pelo Vite.

## Servir o build localmente

```powershell
npm run build
$env:NODE_ENV = 'production'
$env:APP_ORIGIN = 'https://nexo.example'
$env:DATABASE_PATH = Join-Path (Get-Location) 'data/nexo.sqlite'
$env:SESSION_SECRET = node -p "require('node:crypto').randomBytes(32).toString('hex')"
npm start
```

Abra `http://localhost:3000`. O Express serve `web/dist/`, inclusive ao abrir uma rota diretamente pelo navegador. Uma rota desconhecida em `/api` devolve 404 em JSON. Execute `npm run lint` para verificar o código.

O exemplo usa configuração descartável para testar o build via HTTP local. A origem HTTPS configura o endereço público para uso futuro com proxy HTTPS. Use um novo terminal para voltar aos padrões de desenvolvimento.

## Configuração

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | Aceita `development`, `test` e `production`. `npm start` assume `production` e `npm run dev:api` assume `development`. |
| `PORT` | Porta do Express, com padrão 3000. Se alterada em desenvolvimento, use o mesmo valor nos terminais do Express e do Vite. |
| `APP_ORIGIN` | Origem pública. Exige HTTPS em produção e usa `http://localhost:5173` por padrão no desenvolvimento. |
| `DATABASE_PATH` | Caminho do arquivo SQLite. Em produção é absoluto e deve ficar em um diretório persistente. O padrão local é `data/nexo.sqlite`. |
| `SESSION_SECRET` | Segredo obrigatório em produção. Mantenha o valor privado e estável entre reinícios. |

## Banco local e migrações

Na raiz, execute `npm run migrate` para aplicar as migrações ao banco configurado. Na primeira execução com banco vazio, o comando aplica o esquema inicial. Ao rodar novamente, o resultado é `Migrações aplicadas: 0.`

O servidor também aplica migrações pendentes antes de aceitar requisições. As migrações SQL ficam em `api/migrations/`. Execute `npm test` para verificar configuração, rotas e persistência em bancos temporários.

- `web/` contém a interface React e a configuração Vite.
- `api/` contém a aplicação Express.

Consulte os [tutoriais](docs/tutoriais/README.md) para reproduzir as entregas.
