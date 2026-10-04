import { spawnSync } from 'node:child_process';
import { evaluateAudit } from './audit-policy.mjs';

const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm audit --json'] : ['audit', '--json'];
const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

try {
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('npm audit não concluiu; nenhuma exceção aplicada.');
  }
  const report = JSON.parse(result.stdout);
  const { mitigated, unresolved, patch } = evaluateAudit(report, process.cwd());
  console.log(`npm audit: ${Object.keys(report.vulnerabilities).length} entradas reportadas.`);
  if (mitigated.length) {
    console.log(`Mitigação verificada: ${patch.advisory}`);
    console.log(`braces: commit ${patch.commit}, integridade e SHA-256 de todos os arquivos runtime conferidos.`);
    console.log(`Entradas da cadeia corrigida: ${mitigated.join(', ')}.`);
    console.log('O npm reconhece a versão 3.0.3; o patch é upstream ainda não publicado. Consulte docs/security/braces-mitigation.md.');
  }
  if (unresolved.length) {
    for (const name of unresolved) console.error(`${name}: ${JSON.stringify(report.vulnerabilities[name])}`);
    throw new Error(`${unresolved.length} entradas não mitigadas; gate bloqueado.`);
  }
  console.log('Gate aprovado: nenhuma entrada não mitigada.');
} catch (error) {
  console.error(`Falha na auditoria: ${error.message}`);
  process.exitCode = 1;
}
