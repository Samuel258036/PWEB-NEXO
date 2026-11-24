# API de Entrada e Progressão Individual (`/api/play`)

Documentação de referência para os endpoints da capacidade de jogo implementados nas tarefas **5.1–5.6**.

## Requisitos gerais

- **Autenticação:** todas as rotas sob `/api/play` exigem uma sessão autenticada (`401` quando não houver sessão ativa).
- **Mutações (`POST`):** exigem `Origin` válido, `Content-Type: application/json` e token CSRF (`X-CSRF-Token`) obtido na sessão.
- **Presença física:** não é necessária. O jogo é acessado exclusivamente por conta autenticada e pelo nome exato do enigma publicado; nenhum endpoint exige QR code, geolocalização, check-in presencial ou outra comprovação de presença física.
- **Segredo e ocultação de conteúdo:** nenhum payload de `/api/play` retorna respostas (`answer_text` / `answer_key`), enunciados de etapas anteriores ou futuras, dicas não reveladas ou `finalMessage` antes da conclusão — inclusive quando o jogador também é o autor do enigma.

---

## Endpoints

### 1. `POST /api/play/puzzles/open`

Resolve um enigma publicado pelo nome normalizado (`name_key`) e abre — ou retoma de forma idempotente — a partida da conta autenticada.

- **Corpo:**
  ```json
  {
    "name": "O Enigma da Torre"
  }
  ```
- **Resposta (`200 OK`):**
  ```json
  {
    "play": {
      "puzzle": {
        "id": 1,
        "name": "O Enigma da Torre"
      },
      "status": "in_progress",
      "version": 1,
      "currentStep": {
        "id": 10,
        "position": 1,
        "prompt": "Primeira pista",
        "revealedHints": [],
        "hasMoreHints": true
      },
      "finalMessage": null
    }
  }
  ```

### 2. `GET /api/play/puzzles/:id`

Consulta o estado atual da partida da conta autenticada (`in_progress` ou `completed`).

- **Resposta (`200 OK` — em andamento):** retorna `{ "play": { ... } }` com `status: "in_progress"`, `currentStep` preenchido e `finalMessage: null`.
- **Resposta (`200 OK` — concluído):**
  ```json
  {
    "play": {
      "puzzle": {
        "id": 1,
        "name": "O Enigma da Torre"
      },
      "status": "completed",
      "version": 3,
      "currentStep": null,
      "finalMessage": "Parabéns por concluir!"
    }
  }
  ```

### 3. `POST /api/play/puzzles/:id/answer`

Envia uma tentativa de resposta para a etapa atual, verificando `stepId` e `expectedVersion` de forma transacional.

- **Corpo:**
  ```json
  {
    "stepId": 10,
    "expectedVersion": 1,
    "answer": "chave-secreta"
  }
  ```
- **Resposta incorreta (`200 OK`):** não altera o progresso nem a versão; retorna `{ "correct": false, "play": { ... } }`.
- **Resposta correta (`200 OK`):** registra o primeiro acerto global da etapa (`first_solved_at` na primeira solução mundial), avança para a próxima etapa ou conclui a partida e retorna `{ "correct": true, "play": { ... } }`.

### 4. `POST /api/play/puzzles/:id/hints/reveal`

Revela a próxima dica não revelada da etapa atual, opcionalmente validando `hintId` na ordem definida, e exige `stepId` e `expectedVersion`.

- **Corpo:**
  ```json
  {
    "stepId": 10,
    "expectedVersion": 1,
    "hintId": 100
  }
  ```
- **Resposta (`200 OK`):**
  ```json
  {
    "exhausted": false,
    "play": {
      "puzzle": {
        "id": 1,
        "name": "O Enigma da Torre"
      },
      "status": "in_progress",
      "version": 2,
      "currentStep": {
        "id": 10,
        "position": 1,
        "prompt": "Primeira pista",
        "revealedHints": [
          {
            "id": 100,
            "position": 1,
            "text": "Olhe para o topo"
          }
        ],
        "hasMoreHints": false
      },
      "finalMessage": null
    }
  }
  ```

---

## Versões e códigos de erro

- **Controle de versão (`version` / `expectedVersion`):** cada mudança efetiva de etapa, conclusão ou revelação de dica incrementa `progress.version` em uma transação `IMMEDIATE`.
- **Recarga após `STALE_PROGRESS`:** quando `stepId` ou `expectedVersion` não correspondem ao estado vigente — por exemplo, após duplo clique, retry, segunda aba ou partida já concluída — a API responde `409 STALE_PROGRESS`, incluindo `"play"` com o estado atual para que o cliente sincronize e tente novamente.

| Status HTTP | Código (`error.code`) | Quando ocorre |
| :--- | :--- | :--- |
| `400` | `INVALID_BODY` | Corpo JSON inválido ou ausente. |
| `400` | `INVALID_FIELD` | Campo inválido (por exemplo: nome vazio ou reservado; resposta vazia, `/dica` ou `/inicio`; `stepId` ou `hintId` inválido). |
| `400` | `INVALID_VERSION` | `expectedVersion` ausente ou inválido. |
| `404` | `PUZZLE_UNAVAILABLE` | Enigma inexistente, em rascunho, excluído, sem partida aberta para a conta ou com ID inválido. |
| `404` | `INVALID_REFERENCE` | `hintId` informado não pertence à etapa atual. |
| `409` | `STALE_PROGRESS` | `stepId` ou `expectedVersion` desatualizado em relação ao progresso atual (retorna `play` vigente para recarga). |
| `409` | `HINT_OUT_OF_ORDER` | Tentativa de revelar uma dica fora da ordem definida para a etapa. |
```