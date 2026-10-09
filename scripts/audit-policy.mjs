import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export function verifyBracesPatch(root) {
  const patch = JSON.parse(fs.readFileSync(path.join(root, 'security/braces-patch.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const copies = Object.entries(lock.packages).filter(([name]) => /(^|\/)node_modules\/braces$/.test(name));
  if (!copies.length) throw new Error('braces não consta no lockfile; revisar/remover a mitigação explicitamente.');
  for (const [location, entry] of copies) {
    if (entry.resolved !== patch.resolved || entry.integrity !== patch.integrity) {
      throw new Error(`braces sem origem/integridade aprovada: ${location}`);
    }
    const directory = path.join(root, location);
    const runtimeFiles = ['package.json', 'index.js', ...fs.readdirSync(path.join(directory, 'lib')).map((file) => `lib/${file}`)].sort();
    if (JSON.stringify(runtimeFiles) !== JSON.stringify(Object.keys(patch.files).sort())) {
      throw new Error(`Arquivos inesperados no patch de braces: ${location}`);
    }
    for (const [file, expected] of Object.entries(patch.files)) {
      const digest = createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex');
      if (digest !== expected) throw new Error(`Patch de braces ausente ou alterado: ${location}/${file}`);
    }
  }
  const approvedEntries = new Set(copies.map(([location]) => fs.realpathSync(path.join(root, location, 'index.js'))));
  const consumers = ['', ...Object.entries(lock.packages)
    .filter(([, entry]) => entry.dependencies?.braces || entry.optionalDependencies?.braces)
    .map(([location]) => location)];
  for (const consumer of consumers) {
    const require = createRequire(path.join(root, consumer, 'package.json'));
    if (!approvedEntries.has(fs.realpathSync(require.resolve('braces')))) {
      throw new Error(`Entry point de braces não aprovado para ${consumer || 'raiz'}`);
    }
  }
  return { patch, locations: copies.map(([location]) => location) };
}

export function evaluateAudit(report, root) {
  if (report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('Resposta inválida/incompleta do npm audit.');
  }
  const { patch, locations } = verifyBracesPatch(root);
  const findings = report.vulnerabilities;
  const onlyPatchedAdvisory = (name, seen = new Set()) => {
    if (seen.has(name)) return false;
    const finding = findings[name];
    if (!finding || !Array.isArray(finding.via) || finding.via.length === 0) return false;
    const nextSeen = new Set([...seen, name]);
    return finding.via.every((via) => {
      if (typeof via === 'string') return onlyPatchedAdvisory(via, nextSeen);
      return name === 'braces' && via.name === 'braces' && via.url === patch.advisory &&
        Array.isArray(finding.nodes) && finding.nodes.length > 0 &&
        finding.nodes.every((node) => locations.includes(node));
    });
  };
  const mitigated = Object.keys(findings).filter((name) => onlyPatchedAdvisory(name));
  const unresolved = Object.keys(findings).filter((name) => !mitigated.includes(name));
  if (report.metadata.vulnerabilities.total !== Object.keys(findings).length) {
    throw new Error('Contagem inconsistente no npm audit.');
  }
  return { mitigated, unresolved, patch };
}
