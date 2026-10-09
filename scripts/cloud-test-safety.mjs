import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const STAGING_PROJECT_REF = 'iwesoczokkycjovyknnz';
export const STAGING_URL = 'https://' + STAGING_PROJECT_REF + '.supabase.co';

export function loadCloudEnvironment({ env = process.env, root = process.cwd() } = {}) {
  const result = { ...env };
  const file = path.join(root, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || result[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      result[match[1]] = value;
    }
  }
  return result;
}

function reject(message) {
  throw new Error('Teste Cloud bloqueado: ' + message + ' Apenas fincontrol-staging é permitido.');
}

export function assertStagingDatabase({ host, port = '5432', user = 'postgres', database = 'postgres' }) {
  const direct = host === 'db.' + STAGING_PROJECT_REF + '.supabase.co' && user === 'postgres' && String(port) === '5432';
  const pooler = /^aws-\d+-us-east-1\.pooler\.supabase\.com$/.test(host) &&
    user === 'postgres.' + STAGING_PROJECT_REF && ['5432', '6543'].includes(String(port));
  if ((!direct && !pooler) || database !== 'postgres') reject('Conexão PostgreSQL não identificada como staging.');
}

export function assertStagingTarget(env, { root = process.cwd(), requireApi = false, requireLink = true } = {}) {
  if (env.SUPABASE_PROJECT_REF && env.SUPABASE_PROJECT_REF !== STAGING_PROJECT_REF) reject('Project ref incompatível.');
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    let url;
    try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { reject('URL inválida.'); }
    if (url.origin !== STAGING_URL || url.pathname !== '/' || url.username || url.password || url.search || url.hash) reject('URL incompatível.');
  } else if (requireApi) reject('URL de staging ausente.');
  if (requireApi && !(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) reject('Chave pública ausente.');
  if (requireLink) {
    const file = path.join(root, 'supabase/.temp/project-ref');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() !== STAGING_PROJECT_REF) reject('Vínculo CLI incompatível ou ausente.');
  }
  for (const name of ['DATABASE_URL', 'SUPABASE_DB_URL']) {
    if (!env[name]) continue;
    let url;
    try { url = new URL(env[name]); } catch { reject('URL PostgreSQL inválida.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) reject('URL PostgreSQL inválida.');
    for (const [key, value] of url.searchParams) {
      if (key !== 'sslmode' || value !== 'verify-full') reject('Parâmetro de conexão PostgreSQL não permitido.');
    }
    assertStagingDatabase({ host: url.hostname, port: url.port || '5432', user: decodeURIComponent(url.username), database: url.pathname.slice(1) });
  }
  if (env.SUPABASE_DB_HOST || env.SUPABASE_DB_USER || env.SUPABASE_DB_NAME || env.SUPABASE_DB_PORT || env.SUPABASE_DB_PASSWORD) {
    assertStagingDatabase({
      host: env.SUPABASE_DB_HOST || 'db.' + STAGING_PROJECT_REF + '.supabase.co',
      port: env.SUPABASE_DB_PORT || '5432',
      user: env.SUPABASE_DB_USER || 'postgres',
      database: env.SUPABASE_DB_NAME || 'postgres',
    });
  }
}

export function runSupabaseCli(args, { root = process.cwd(), env = process.env, execute = execFileSync } = {}) {
  assertStagingTarget(env, { root });
  const refIndex = args.indexOf('--project-ref');
  const allowed = args[0] === 'db' && args[1] === 'query' || args[0] === 'projects' && args[1] === 'api-keys';
  if (!allowed || refIndex < 0 || args[refIndex + 1] !== STAGING_PROJECT_REF || args.some(arg => /^(--db-url|--local|--workdir|--project-ref=)/.test(arg))) reject('Argumentos CLI incompatíveis com staging.');
  // Invoke the installed Node entrypoint directly: no cmd, shell, or npx downloads.
  const entry = path.join(root, 'node_modules/supabase/dist/supabase.js');
  return execute(process.execPath, [entry, ...args], {
    cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
  });
}

export function getStagingServiceRoleKey(env, options = {}) {
  assertStagingTarget(env, { ...options, requireApi: true });
  let keys;
  try {
    keys = JSON.parse(runSupabaseCli(['projects', 'api-keys', '--project-ref', STAGING_PROJECT_REF, '--reveal', '--output', 'json'], { ...options, env }));
  } catch {
    reject('Não foi possível verificar as credenciais com a CLI.');
  }
  const service = keys.find(key => key.name === 'service_role' || key.tags?.includes('service_role'))?.api_key;
  if (!service) reject('Credencial administrativa de staging indisponível.');
  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY !== service) reject('Credencial administrativa incompatível.');
  for (const name of ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    if (!env[name]) continue;
    const match = keys.find(key => key.api_key === env[name] &&
      (key.name === 'anon' || key.api_key.startsWith('sb_publishable_') || key.tags?.includes('publishable')));
    if (!match) reject('Credencial pública incompatível.');
  }
  return service;
}
