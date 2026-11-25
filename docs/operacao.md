# Operação do Nexo

## Volume e migração

Use um arquivo SQLite em volume local persistente, com uma instância do Nexo. Mantenha o mesmo `SESSION_SECRET`, a mesma origem e o mesmo caminho do banco entre reinícios. Preserve o segredo no ambiente de execução.

Com as [variáveis de produção](../README.md#configuração) preparadas, execute `npm run migrate` na raiz. O comando aplica as versões pendentes em uma transação. A execução seguinte reporta `Migrações aplicadas: 0.` quando o banco está atualizado. O servidor também verifica e aplica a fila antes de ouvir a porta.

## Backup online

Com `DATABASE_PATH` apontando ao banco em execução, escolha um nome novo em um diretório privado já existente. Use um volume com suporte a hard links, como NTFS ou ext4. A implantação deve manter acesso restrito ao diretório, pois o snapshot inclui hashes de senha, sessões e dados de jogo.

```powershell
$snapshotPath = Join-Path (Get-Location) 'data/nexo-antes-da-migracao.sqlite'
npm run backup -- $snapshotPath
```

O comando abre a origem em modo somente leitura e usa a API de backup online do SQLite. O snapshot passa por verificações de integridade e de chaves estrangeiras em um arquivo temporário no volume de destino. Ao final, um link publica o arquivo completo. Um destino ocupado gera erro e preserva o arquivo existente. Ao receber `Backup criado e verificado.`, guarde o snapshot em local de acesso restrito. A API incorpora dados do WAL, inclusive páginas que ainda aguardam checkpoint. [API de backup do SQLite](https://sqlite.org/backup.html) · [Método backup do better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise)

## Restaurar em uma cópia

Escolha outro caminho no diretório privado. Copie o snapshot finalizado usando a operação abaixo, que exige um destino livre.

```powershell
$restoredPath = Join-Path (Get-Location) 'data/nexo-restaurado.sqlite'
[IO.File]::Copy($snapshotPath, $restoredPath)
```

Inspecione a cópia antes de subir um processo. O resultado esperado é `ok` na integridade e zero referências inválidas, além da lista de migrações da versão restaurada.

```powershell
$inspectCopy = @'
import Database from 'better-sqlite3'
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true })
try {
  const integrity = db.pragma('integrity_check', { simple: true })
  const issues = db.pragma('foreign_key_check')
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()
  console.log({ integrity, invalidReferences: issues.length, versions })
  if (integrity !== 'ok' || issues.length > 0) process.exitCode = 1
} finally {
  db.close()
}
'@
node --input-type=module -e $inspectCopy -- $restoredPath
```

Inicie uma instância isolada com `DATABASE_PATH` apontando à cópia e um build compatível com as versões exibidas. Use uma porta diferente se as duas instâncias estiverem ativas. Confirme `GET /api/health`, a conta e a partida de teste. Para verificar a continuidade da sessão, pare a instância de teste anterior e use a mesma origem pública, o mesmo segredo e o cookie original.

## Encerrar e reiniciar

Acione o serviço com `SIGTERM` no ambiente que entrega sinais ao processo Node. Em um terminal interativo, `Ctrl+C` aciona o tratamento de `SIGINT`. O servidor para de aceitar novas conexões, deixa as requisições em andamento terminarem e fecha o repositório de sessões e o banco.

O processo encerra com código zero após uma drenagem bem-sucedida. Se o prazo de dez segundos vencer, as conexões restantes são fechadas e o processo retorna código 1. Aguarde a saída do processo antigo antes de iniciar o novo na mesma porta e no mesmo volume. Confirme a saúde e consulte sessão e progresso com a sessão já aberta. [Sinais no Node.js](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events)

## Reversão

Antes de trocar o build, compare as migrações registradas com o esquema que o build de destino suporta. Execute o build anterior sobre uma cópia do banco atual e confira a aplicação de migrações, a saúde e o progresso de teste. A reversão apenas do código exige compatibilidade comprovada com o esquema presente.

Quando o esquema for incompatível, suspenda a escrita e selecione um snapshot anterior já verificado em cópia. Compare o conteúdo restaurado com as exclusões confirmadas depois do backup. Reconcilie essas exclusões antes de promover a cópia para evitar a volta de enigmas ou progresso removidos. Preserve o banco atual para inspeção, promova o arquivo verificado como uma ação explícita e retome o serviço somente após validar saúde, sessão e progresso. Remova os snapshots temporários conforme o procedimento de retenção do ambiente.

## Repetir o ensaio local

Execute `node --test api/test/operations.test.js` na raiz. O ensaio usa Express e SQLite reais em HTTP loopback, uma pasta descartável e contas de teste. Executa as CLIs de migração e backup, encerra o servidor com uma requisição em andamento e verifica o mesmo cookie, etapa, dica e versão após o reinício e ao subir a cópia restaurada. No Windows, o fixture emite os eventos de sinal no processo filho via IPC para acionar os handlers do serviço. A verificação de HTTPS e cookies `Secure` está no [teste E2E](tutoriais/define-puzzle-platform-mvp/8.1.md).
