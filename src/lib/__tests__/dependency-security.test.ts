import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateAudit, verifyBracesPatch } from '../../../scripts/audit-policy.mjs';

const require = createRequire(import.meta.url);
const braces = require('braces');
const advisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const temporaryRoots: string[] = [];

function report() {
  return {
    vulnerabilities: {
      braces: { via: [{ name: 'braces', url: advisory }], nodes: ['node_modules/braces'] },
      micromatch: { via: ['braces'], nodes: ['node_modules/micromatch'] },
    },
    metadata: { vulnerabilities: { total: 2 } },
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('braces: regressão de profundidade da dependência instalada', () => {
  it.each(['parse', 'compile', 'expand', 'stringify'])('%s aceita 100 níveis e rejeita 101 em chaves e parênteses', (method) => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const pattern = (depth: number) => open.repeat(depth) + 'a' + close.repeat(depth);
      expect(() => braces[method](pattern(100))).not.toThrow();
      expect(() => braces[method](pattern(101))).toThrow(/exceeds max depth/);
      expect(() => braces[method](pattern(2), { maxDepth: 1.5 })).toThrow(/exceeds max depth/);
      expect(() => braces[method](pattern(101), { maxDepth: Infinity })).toThrow(/exceeds max depth/);
    }
  });

  it.each(['compile', 'expand', 'stringify'])('%s rejeita AST fornecida pelo chamador com profundidade excessiva', (method) => {
    let node: { type: string; nodes?: unknown[]; value?: string } = { type: 'text', value: 'a' };
    for (let depth = 0; depth < 101; depth++) node = { type: 'brace', nodes: [node] };
    expect(() => braces[method]({ type: 'root', nodes: [node] })).toThrow(/exceeds max depth/);
  });

  it('preserva expansão de globs e a representação de chaves válidas com escapeInvalid', () => {
    expect(braces.expand('src/{app,lib}/**/*.{ts,tsx}')).toEqual([
      'src/app/**/*.ts', 'src/app/**/*.tsx', 'src/lib/**/*.ts', 'src/lib/**/*.tsx',
    ]);
    expect(braces.stringify(braces.parse('{{a,b},c}'), { escapeInvalid: true })).toBe('{{a,b},c}');
  });
});

describe('gate de audit com patch comprovado', () => {
  it.each(['main', 'exports'])('rejeita metadado de resolução %s adulterado', (field) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fincontrol-braces-'));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, 'security'));
    fs.copyFileSync('security/braces-patch.json', path.join(root, 'security/braces-patch.json'));
    fs.copyFileSync('package-lock.json', path.join(root, 'package-lock.json'));
    fs.cpSync('node_modules/braces', path.join(root, 'node_modules/braces'), { recursive: true });
    const metadataPath = path.join(root, 'node_modules/braces/package.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata[field] = './alternate.cjs';
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    fs.writeFileSync(path.join(root, 'node_modules/braces/alternate.cjs'), 'module.exports = {};');
    expect(() => verifyBracesPatch(root)).toThrow();
  });

  it('reconhece apenas a cadeia do advisory corrigido quando origem e bytes conferem', () => {
    expect(evaluateAudit(report(), process.cwd())).toMatchObject({
      mitigated: ['braces', 'micromatch'], unresolved: [],
    });
  });

  it('mantém bloqueado um novo advisory no mesmo pacote e seus dependentes', () => {
    const input = report();
    input.vulnerabilities.braces.via.push({ name: 'braces', url: 'https://github.com/advisories/GHSA-new' });
    expect(evaluateAudit(input, process.cwd()).unresolved).toEqual(['braces', 'micromatch']);
  });

  it('bloqueia um alerta sem relação com braces', () => {
    const input = report();
    Object.assign(input.vulnerabilities, { other: { via: [{ name: 'other', url: advisory }], nodes: [] } });
    input.metadata.vulnerabilities.total = 3;
    expect(evaluateAudit(input, process.cwd()).unresolved).toEqual(['other']);
  });

  it('rejeita erro da registry ou relatório sem contagem consistente', () => {
    expect(() => evaluateAudit({ error: { code: 'ENETWORK' } }, process.cwd())).toThrow(/inválida/);
    const input = report();
    input.metadata.vulnerabilities.total = 0;
    expect(() => evaluateAudit(input, process.cwd())).toThrow(/Contagem inconsistente/);
  });

  it('rejeita byte alterado na cópia instalada, mesmo com lockfile aprovado', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fincontrol-braces-'));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, 'security'));
    fs.copyFileSync('security/braces-patch.json', path.join(root, 'security/braces-patch.json'));
    fs.copyFileSync('package-lock.json', path.join(root, 'package-lock.json'));
    fs.cpSync('node_modules/braces', path.join(root, 'node_modules/braces'), { recursive: true });
    fs.appendFileSync(path.join(root, 'node_modules/braces/lib/constants.js'), '\n// altered\n');
    expect(() => verifyBracesPatch(root)).toThrow(/ausente ou alterado/);
  });

  it('rejeita origem não aprovada, mesmo com arquivos instalados corrigidos', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fincontrol-braces-'));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, 'security'));
    fs.copyFileSync('security/braces-patch.json', path.join(root, 'security/braces-patch.json'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    lock.packages['node_modules/braces'].resolved = 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz';
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    expect(() => verifyBracesPatch(root)).toThrow(/origem\/integridade/);
  });
});
