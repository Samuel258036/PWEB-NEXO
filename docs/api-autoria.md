# API de autoria e publicação

Todas as rotas abaixo usam o prefixo `/api/author`, exigem sessão autenticada e retornam JSON. Toda mutação exige `Origin` igual a `APP_ORIGIN` e `x-csrf-token` obtido em `GET /api/auth/session`. Corpos JSON têm limite de 2 MiB.

## Listagem e rascunhos

### `GET /puzzles`

Lista somente os itens do autor atual:

```json
{ "puzzles": [{ "id": 12, "name": "Meu enigma", "status": "draft", "version": 1, "updatedAt": "2026-11-22 12:00:00" }] }
```

### `POST /puzzles`

Reserva o nome ao criar o rascunho e retorna `201` com o snapshot salvo. `steps` e `finalMessage` são opcionais. O primeiro salvamento persiste todos os campos enviados em uma transação.

```json
{
  "name": "Meu enigma",
  "finalMessage": "Você chegou ao fim.",
  "steps": [{ "prompt": "Leia a pista", "answer": "", "hints": [{ "text": "Consulte o mapa" }] }]
}
```

Nome inválido retorna `400 INVALID_FIELD`; nome reservado retorna `409 NAME_TAKEN`.

### `GET /puzzles/:id`

Retorna o snapshot próprio com campos `id`, `author_id`, `name_display`, `status`, `version`, `final_message`, datas e `steps`. Cada etapa inclui `id`, `position`, `prompt`, `answer_text`, `answer_key`, `first_solved_at` e `hints`. ID ausente ou de outra conta retorna `404 NOT_FOUND`.

### `PUT /puzzles/:id/draft`

Salva o snapshot inteiro. Etapas existentes enviam seu `id`; etapas novas omitem o ID. A ordem do array define `position`. A versão enviada deve ser a lida no último GET:

```json
{
  "name": "Meu enigma renomeado",
  "version": 2,
  "steps": [
    { "id": 31, "prompt": "Leia a pista", "answer": "biblioteca" },
    { "prompt": "Nova etapa", "answer": "" }
  ]
}
```

O exemplo preserva a etapa 31 e acrescenta uma etapa. Campos incompletos são aceitos enquanto rascunho. IDs de outra etapa ou enigma retornam `404 INVALID_REFERENCE`. Versão antiga retorna `409 VERSION_CONFLICT`. Nome ocupado retorna `409 NAME_TAKEN`.

Omitir `finalMessage` ou `hints` preserva os valores já salvos. Envie `finalMessage: ""` para limpar a mensagem ou `hints: []` para remover as dicas daquela etapa. Dicas existentes usam seu `id` e conservam a ordem relativa. Dicas novas omitem o ID e entram no final. Erros de campo incluem `error.fields` com caminhos como `name` ou `steps.0.hints.0.text`.

## Publicação e manutenção

### `POST /puzzles/:id/publish`

Publica o snapshot salvo, sem aceitar alterações locais implícitas:

```json
{ "expectedVersion": 3 }
```

Exige pelo menos uma etapa com enunciado e resposta. Dicas e mensagem final são opcionais. Conteúdo incompleto retorna `400 DRAFT_INCOMPLETE`; estado concorrente retorna `409 VERSION_CONFLICT`. Sucesso incrementa versão e preenche `published_at`; não existe operação de pausa nem retorno a rascunho.

### `PATCH /steps/:stepId/content`

```json
{ "prompt": "Novo enunciado", "answer": "resposta", "expectedVersion": 4 }
```

O enunciado continua editável após solução. A resposta só muda antes do primeiro acerto; depois disso, o texto enviado para `answer` é ignorado e a resposta vigente é preservada. Cada atualização incrementa a versão do enigma.

### `PATCH /puzzles/:id/final-message`

```json
{ "finalMessage": "Você chegou ao fim deste nexo.", "expectedVersion": 5 }
```

A mensagem final aceita texto vazio, para usar a mensagem padrão, ou texto de até 4.000 caracteres.

### Dicas

- `POST /steps/:stepId/hints`: `{ "text": "Observe o mapa", "expectedVersion": 5 }`; cria no fim e retorna `201` com a lista em ordem.
- `PATCH /hints/:hintId`: `{ "text": "Texto atualizado", "expectedVersion": 6 }`; edita sem trocar ID ou posição.
- `DELETE /hints/:hintId`: envia a versão atual no cabeçalho `If-Match`; remove a dica e compacta as posições seguintes.

Não há endpoint para reordenar dicas. Conflito de versão retorna `409 VERSION_CONFLICT`; dica/etapa alheia retorna `404 INVALID_REFERENCE`.

### `DELETE /puzzles/:id`

Exige confirmação e a versão atual:

```json
{ "confirmed": true, "expectedVersion": 7 }
```

Sem confirmação retorna `400 CONFIRMATION_REQUIRED`. A exclusão remove conteúdo e progresso em cascata; a conta permanece e o nome fica livre.

## Códigos comuns

| HTTP | Código | Uso |
| --- | --- | --- |
| 400 | `INVALID_BODY`, `INVALID_FIELD`, `INVALID_VERSION`, `DRAFT_INCOMPLETE`, `CONFIRMATION_REQUIRED` | Payload ou estado incompleto |
| 401 | `AUTHENTICATION_REQUIRED` | Sessão ausente |
| 403 | `ORIGIN_FORBIDDEN`, `CSRF_INVALID` | Proteção da mutação |
| 404 | `NOT_FOUND`, `INVALID_REFERENCE` | Recurso inexistente ou de outra conta |
| 409 | `NAME_TAKEN`, `VERSION_CONFLICT` | Nome reservado ou edição concorrente |
