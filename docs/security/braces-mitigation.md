# Mitigação temporária de braces — GHSA-vfj7-8cjw-p6xm

Em 03/10/2026, braces 3.0.3 continua sendo a última versão npm, sem release corrigida. Upgrade major de Tailwind não elimina necessariamente todas as outras cadeias de build/lint.

O override de `braces` utiliza o tarball do commit imutável `28d440b5dd449dbf1fe6f3506cf94ecca4d02660` do fork FSDevelop/braces, proposto no [PR upstream #72](https://github.com/micromatch/braces/pull/72). O PR ainda não foi integrado/publicado pelos mantenedores. Não foi alterado o número de versão para esconder o advisory.

## Correção e verificação

O patch limita a profundidade de chaves/parênteses a 100 no parser e nos walkers compile, expand e stringify, inclusive ASTs fornecidas pelo chamador; limites menores são respeitados e ciclos de parent em expand são rejeitados. A diferença em relação ao pacote npm foi revisada e os 904 testes upstream passaram no Node 24.19.0 desta máquina. Regressões locais exercitam os entry points e a política de auditoria.

`security/braces-patch.json` fixa origem, commit, integridade do tarball e SHA-256 de todos os arquivos runtime e do package.json instalado (main/exports). O gate também resolve braces a partir da raiz e de cada consumidor no lockfile e exige um entry point aprovado. O lockfile preserva os demais pacotes. `npm ci` instala o mesmo artefato no Windows/Linux; não existe postinstall que modifique arquivos silenciosamente.

## Gate de auditoria

- `npm audit` permanece disponível e continua reportando seis entradas da cadeia, pois compara o número de versão do pacote com a base de advisories, sem reconhecer esse patch.
- `npm run audit` executa esse audit em JSON e **falha** se a consulta der erro, o relatório for inválido, qualquer cópia de braces estiver fora do pin/integridade/hash, ou houver qualquer advisory não corrigido por este patch.
- Só reconhece o advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) quando os bytes corrigidos forem comprovados. Entradas transitivas só são consideradas mitigadas se todos os seus advisories terminarem nessa mesma folha verificada. Alertas adicionais em qualquer pacote continuam bloqueando o gate, independentemente da severidade.
- O resultado informa a mitigação e as entradas ainda presentes no scanner. **Gate aprovado com patch verificado não significa que o npm bruto reportou zero.**

Não há aceite genérico de risco, filtro por severidade, nem desativação de auditoria. O fornecedor adicional é temporário e o código fixado precisa ser revisto independentemente no agente 1.

## Remover a mitigação

Quando existir uma release oficial corrigida, atualizar o lockfile e remover o override, os scripts/política/manifesto temporários e as regressões específicas do pin; restaurar o script audit para `npm audit`. Rodar instalação limpa, auditoria bruta, testes, lint, typecheck e builds nos dois modos. Não remover apenas a verificação de hashes mantendo a exceção.
