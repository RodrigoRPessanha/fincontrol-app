# Backups do FinControl no Cloudflare R2

Status: preparação implementada, **sem execução Cloud, sem agendamento diário e sem
restauração homologada**. Não substitui o gate de recuperação antes da V14.

## Fluxo e escopo

`.github/workflows/backup.yml` executa `scripts/backup_cloud.py` em
Linux, sem Docker, servidor local, build ou suíte financeira. A origem é escolhida
explicitamente: staging (`iwesoczokkycjovyknnz`) ou produção (`exvjusubjjvjcdxtjfgf`).
Há dispatch manual e um trigger inicial somente para push em staging que altere
o próprio backup.yml: ele sempre usa staging e ainda exige BACKUP_ENABLED=true.
Esse trigger permite homologar após o PR, sem promover V14/main; removê-lo quando
o workflow manual estiver disponível na default branch. Não roda em PR/feature
branch/main push, nem executa backup automático de produção.

O script exige clientes e servidor PostgreSQL 17, conexão TLS com verificação de
certificado e porta 5432 (direta ou session pooler; não transaction pooler 6543).
Usa a CA pública oficial versionada em `supabase/certs/prod-ca-2021.crt`;
`sslrootcert=system` não basta para a cadeia privada do Supabase. O arquivo foi
obtido pelo link Download certificate no painel de staging, via HTTPS, e a cadeia
do pooler/hostname foi validada com OpenSSL. Fingerprint SHA256 do certificado DER:
`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
Faz um `pg_dump` custom do banco inteiro, preservando o snapshot consistente dos
dados, e exporta roles sem senhas. Inclui Auth, public, histórico de migrations,
catálogo do arquivo e manifesto com hashes/versões. Não filtra schemas gerenciados
silenciosamente: falta de acesso a qualquer objeto encerra a exportação.

O pacote é criptografado com `age` antes do upload. Apenas a chave **pública** fica
no Actions. A cópia do R2 é baixada e comparada por SHA-256; o ETag não é usado como
checksum. Arquivos locais temporários são removidos ao terminar. Nenhum dump vira
artifact, log ou arquivo Git. Uma cópia remota com falha de verificação deve ser
investigada; não há exclusão remota automática pelo script.

## Configuração pendente

1. Ativar R2 e criar bucket privado `fincontrol-backups`, classe **Standard**.
   Manter domínio público/r2.dev desativados. Não precisa de domínio próprio.
2. Criar regra de ciclo de vida por prefixo `staging/` e `production/`, expiração
   após 30 dias. Confirmar retenção antes de ativar (não aplicar ao bucket inteiro
   caso contenha outros arquivos). Manter aborto de multipart incompleto.
3. Gerar identidade com `age-keygen -o <arquivo-privado-fora-do-repo>`. Guardar a
   chave privada e uma cópia segura independente; sem ela os backups são inúteis.
   Registrar somente o recipient público `age1...` no GitHub.
4. Criar credencial R2 Object Read & Write restrita a este bucket. Para isolamento
   mais forte entre ambientes, usar buckets/credenciais separados. Sem token de
   administração da conta no Actions.
5. Criar GitHub Environments `backup-staging` e `backup-production`. Restringir
   execução de `backup-staging` somente à branch `staging` e de `backup-production`
   somente à branch `main`, sem tags; nunca disponibilizar secrets
   a branches ou PRs arbitrários. Usar revisão de ambiente quando disponível.

Em **cada environment**, configurar:

| Tipo | Nome | Valor |
|---|---|---|
| Variable | `BACKUP_ENABLED` | `true` somente após preparar acesso e chave |
| Variable | `BACKUP_PGHOST` | Host do Connect → Session pooler do projeto correto |
| Variable | `BACKUP_PGUSER` | `backup_reader.<project-ref>` (direta: `backup_reader`) |
| Variable | `R2_ACCOUNT_ID` | Account ID Cloudflare, 32 caracteres hexadecimais |
| Variable | `R2_BUCKET` | Nome do bucket privado |
| Variable | `BACKUP_AGE_RECIPIENT` | Chave pública age |
| Secret | `BACKUP_DB_PASSWORD` | Senha exclusiva de backup_reader nesse ambiente |
| Secret | `R2_ACCESS_KEY_ID` | Access Key ID da credencial limitada ao bucket |
| Secret | `R2_SECRET_ACCESS_KEY` | Secret Access Key correspondente |

Não reutilizar automaticamente os secrets dos testes staging para produção. Não
colar senhas em mensagens, argumentos de comando ou connection strings em logs.

### Role dedicada e privilégios herdados

O runner recusa postgres. `supabase/operations/create_backup_reader.sql` cria a role
backup_reader sem login/senha, superuser, CREATEDB, CREATEROLE ou replicação; única
membership pg_read_all_data. BYPASSRLS permite exportar todas as linhas (inclusive
Auth), sem modificar policies de anon/authenticated. Provisionamento é operacional,
fora das migrations de aplicação, e exige escolha explícita do projeto.

O runner confere identidade, memberships, ownership, CREATE, escrita efetiva em
tabelas/sequências e EXECUTE em SECURITY DEFINER antes de exportar. O default
transaction_read_only previne acidentes, mas o cliente pode desligá-lo. PUBLIC
também fornece funções de catálogo e objetos temporários: não é um servidor
fisicamente somente leitura.

**Exceção aceita somente em staging, 08/10/2026:** cron.job_run_details concede SELECT/DELETE a
PUBLIC, com owner/grantor supabase_admin. Backup_reader herda DELETE mesmo sem
GRANT individual. A tentativa em `supabase/operations/harden_backup_cron_acl.sql`
não removeu o privilégio e foi abortada pela checagem ativa. O mantenedor autorizou
prosseguir com staging: o runner aceita somente DELETE, sem grant option, nessa
tabela regular pertencente a supabase_admin. Qualquer outra escrita/objeto bloqueia
o export, e produção não recebe essa exceção. O manifesto criptografado registra
a exceção quando presente. Corrigir o grant original antes da automação Production.
Não usar postgres como contorno; produção não provisionada.

Após validar a exceção em staging, o operador define senha independente e LOGIN em sessão
privada e cadastra essa senha no secret do environment correspondente. Nunca salvar
SQL com senha no Git/editor compartilhado/logs. Não conceder membership de postgres,
authenticated ou service_role. Restauração usa credencial administrativa separada.
Reauditar privilégios depois de atualizações das extensões.

## Primeira homologação e recuperação

O dispatch só aparece normalmente quando o workflow existe na default branch.
Para validar antes da promoção, usar o dispatch com ref confiável quando suportado
pelo GitHub ou executar o script em máquina com ferramentas nativas e ambiente
privado. Não promover código para produção só para habilitar o botão do workflow.

Primeiro exportar staging, confirmar o objeto privado e o tamanho real. Baixar a
cópia, descriptografar com a identidade privada, verificar os hashes do manifesto
e inspecionar `pg_restore --list database.dump`. **Isso ainda não testa restauração.**

Restaurar somente em projeto Supabase Cloud descartável separado, após revisar o
TOC. Não aplicar cegamente um dump completo sobre schemas/roles gerenciados do
Supabase, nem usar `--clean`/`--create` em staging ou produção. Preparar um roteiro
específico que preserve Auth, FKs, triggers personalizados em Auth, RLS, grants,
default ACLs, event triggers, migrations, extensões e cron. Recriar a configuração
externa Auth/SMTP/URLs/Vercel. Senhas de roles, objetos Storage e chaves raiz Vault
não são recuperados pelo pacote; registrar separadamente qualquer uso de Vault.

Conferir contagens, identidades, login, isolamento de workspace, RPCs e contratos
financeiros no destino; impedir que cron restaurado ou e-mails de teste produzam
efeitos externos. Registrar tempo de recuperação e resultado. O script não contém
comando de restauração para evitar sobrescrita acidental.

## Rotina diária (ainda desativada)

Após ensaio aprovado, adicionar `schedule` diário no workflow da default branch,
fixando origem production e environment backup-production; preservar dispatch
manual pré-migration. Habilitar notificações de falhas do Actions e documentar
quem verifica ausência de execução: um workflow que não iniciou não gera falha.
Schedules podem atrasar ou ser desativados por inatividade em repositórios públicos.
Backup diário implica perda potencial de aproximadamente um dia de gravações;
30 dias de retenção não oferecem recuperação a qualquer segundo (PITR).

## Verificação local sem conta

`python -m unittest discover -s scripts/tests -p 'test_backup_cloud.py'`

Os testes cobrem alvo incorreto, recusa de postgres/privilégios herdados, configuração incompleta, não exposição de erros,
separação de credenciais, exportação recusada, envio só de ciphertext e corrupção
da cópia remota. Ferramentas externas são simuladas; não homologam criptografia,
permissões Cloud, TLS, PostgreSQL/R2 real ou restauração.

Referências: [Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[R2 e AWS CLI](https://developers.cloudflare.com/r2/examples/aws/aws-cli/),
[retenção R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
[clientes PostgreSQL](https://www.postgresql.org/download/linux/ubuntu/).
