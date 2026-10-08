# Atualizações de segurança — outubro/2026

Para manter o gate de auditoria ao publicar o backup Cloud, o lockfile atualiza
`sharp` 0.35.4 → 0.35.5 e `source-map-js` 1.2.1 → 1.2.2. Um override fixa
`postcss-selector-parser` 7.1.6, inclusive sob Tailwind 3 e postcss-nested 6;
não há migração para Tailwind 4 nem alteração da política de exceções do audit.

O override cruza o major declarado pelos consumidores; compatibilidade foi
verificada com typecheck, lint, 835 testes/coverage e build de todas as rotas.
Uma conversão SVG→PNG real confirmou o sharp atualizado. Monitorar próximas
atualizações dos consumidores para remover o override quando dispensável.

`npm run audit` passou: nenhuma entrada não mitigada. As seis entradas relacionadas
ao patch upstream de braces continuam verificadas pela política já existente,
descrita em [braces-mitigation.md](./braces-mitigation.md).

Referências:
- [Parser CSS: versão corrigida 7.1.6](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)
- [Sharp: versão corrigida 0.35.5](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [Source maps: versão corrigida 1.2.2](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
