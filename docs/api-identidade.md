# API de identidade e sessão

As rotas usam o prefixo `/api/auth`. A mesma conta permite jogar e criar enigmas. A API não oferece recuperação de senha nem cadastro separado para autores.

## Sessão e requisitos das mutações

`GET /api/auth/session` retorna `200` com `user` e `csrfToken`. `user` é `null` para visitantes. Para uma conta autenticada, `user` tem os campos `id` e `usernameDisplay`.

Use o cookie `nexo.sid` recebido nessa consulta nas requisições seguintes. Nos `POST`, envie a origem configurada em `APP_ORIGIN` no cabeçalho `Origin` e o token da sessão em `X-CSRF-Token`. Para corpos JSON, use `Content-Type: application/json`. Consulte novamente a sessão quando precisar de um novo cookie ou token.

## Identificação, cadastro e login

| Rota | Corpo JSON de exemplo | Resposta de sucesso |
| --- | --- | --- |
| `POST /api/auth/identify` | `{"username":"Pessoa Demo"}` | `200` com `{"state":"existing"}` ou `{"state":"new"}`. A consulta não cria conta. |
| `POST /api/auth/register` | `{"username":"Pessoa Demo","password":"senha local de exemplo","confirmedNew":true}` | `201` com `user` e `csrfToken` autenticados. |
| `POST /api/auth/login` | `{"username":"Pessoa Demo","password":"senha local de exemplo"}` | `200` com `user` e `csrfToken` autenticados. |
| `POST /api/auth/logout` | Sem corpo | `200` com `user: null` e um `csrfToken`. A sessão anterior é revogada. Use `GET /api/auth/session` para estabelecer a próxima sessão antes de enviar outro `POST`. |

O nome tem de 1 a 64 caracteres após a remoção dos espaços externos. A comparação ignora diferenças de caixa. No cadastro, a senha tem de 12 a 128 caracteres e preserva caixa e espaços. Cadastro e login renovam o ID de sessão. Use o novo cookie e o novo token nas próximas requisições.

## Erros esperados

As falhas de validação e autenticação retornam `{"error":{"code":"…","message":"…"}}`.

| HTTP | Código | Condição |
| --- | --- | --- |
| 400 | `INVALID_BODY`, `INVALID_JSON`, `INVALID_FIELD` | Corpo inválido, JSON malformado ou campo inválido. |
| 400 | `CONFIRMATION_REQUIRED` | Cadastro sem `confirmedNew: true`. |
| 401 | `AUTHENTICATION_FAILED` | Nome ou senha incorretos no login. |
| 403 | `ORIGIN_FORBIDDEN`, `CSRF_INVALID` | O `POST` tem origem ou token ausente ou inválido. |
| 409 | `NAME_TAKEN` | O nome do cadastro já pertence a uma conta. |
| 413 | `BODY_TOO_LARGE` | O corpo excede 2 MiB. |
| 429 | `RATE_LIMITED` | O IP ultrapassou 10 requisições de identificação, cadastro e login somadas em um minuto. O cabeçalho `Retry-After` informa a espera em segundos. |
| 503 | `PASSWORD_HASH_QUEUE_FULL` | A fila de autenticação está temporariamente cheia. |

As rotas protegidas de jogo e autoria retornam `401 AUTHENTICATION_REQUIRED` para sessão ausente quando a requisição passa pela validação de origem e CSRF.

## Cookie e proxy

`nexo.sid` usa `HttpOnly`, `SameSite=Lax`, `Path=/` e expiração de sete dias. Em produção, `NODE_ENV=production` ativa `Secure` e `APP_ORIGIN` deve usar HTTPS. Se o HTTPS terminar em um proxy, configure `TRUST_PROXY_HOPS` com a quantidade real de proxies confiáveis e encaminhe o protocolo original em `X-Forwarded-Proto`. O valor padrão de `TRUST_PROXY_HOPS` é `0`.

O servidor persiste sessões no SQLite em `DATABASE_PATH` e assina o cookie com `SESSION_SECRET`. Mantenha o mesmo segredo e banco entre reinícios para preservar sessões válidas.
