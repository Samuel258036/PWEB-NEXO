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
npm start
```

Abra `http://localhost:3000`. O Express serve `web/dist/`, inclusive ao abrir uma rota diretamente pelo navegador. Uma rota desconhecida em `/api` devolve 404 em JSON. Execute `npm run lint` para verificar o código.

- `web/` contém a interface React e a configuração Vite.
- `api/` contém a aplicação Express.

Consulte os [tutoriais](docs/tutoriais/README.md) para reproduzir as entregas.
