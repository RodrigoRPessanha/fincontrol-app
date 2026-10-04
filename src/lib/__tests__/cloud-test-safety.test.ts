import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  STAGING_PROJECT_REF, STAGING_URL, loadCloudEnvironment,
  assertStagingTarget, getStagingServiceRoleKey, runSupabaseCli,
} from '../../../scripts/cloud-test-safety.mjs';

const roots: string[] = [];
function fixture(link = STAGING_PROJECT_REF) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fincontrol-cloud-safety-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'supabase/.temp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'supabase/.temp/project-ref'), link);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const stageEnv = { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
const inventory = JSON.stringify([{ name: 'service_role', api_key: 'fixture-service' }, { name: 'publishable', api_key: 'sb_publishable_fixture' }]);

describe('Cloud test environment safety', () => {
  it('uses CI environment without requiring .env.local', () => {
    const root = fixture();
    expect(loadCloudEnvironment({ root, env: stageEnv })).toEqual(stageEnv);
    expect(() => assertStagingTarget(stageEnv, { root, requireApi: true })).not.toThrow();
  });
  it('keeps process.env precedence, including deliberately empty values', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=https://wrong.supabase.co\nSUPABASE_DB_PASSWORD=local-password\nNEXT_PUBLIC_DATA_MODE=supabase # Cloud\n');
    const env = loadCloudEnvironment({ root, env: { ...stageEnv, SUPABASE_DB_PASSWORD: '' } });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(STAGING_URL);
    expect(env.SUPABASE_DB_PASSWORD).toBe('');
    expect(env.NEXT_PUBLIC_DATA_MODE).toBe('supabase');
  });
  it.each([
    { SUPABASE_PROJECT_REF: 'exvjusubjjvjcdxtjfgf' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://exvjusubjjvjcdxtjfgf.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL + '/?redirect=other' },
    { DATABASE_URL: 'postgres://postgres:secret@db.exvjusubjjvjcdxtjfgf.supabase.co:5432/postgres' },
    { SUPABASE_DB_HOST: 'db.exvjusubjjvjcdxtjfgf.supabase.co' },
    { SUPABASE_DB_URL: 'postgres://postgres.iwesoczokkycjovyknnz:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?host=db.exvjusubjjvjcdxtjfgf.supabase.co' },
    { SUPABASE_DB_HOST: 'aws-0-us-east-1.pooler.supabase.com', SUPABASE_DB_USER: 'postgres.exvjusubjjvjcdxtjfgf' },
  ])('rejects production or ambiguous targets before invoking any CLI', (overrides) => {
    const execute = vi.fn(() => inventory);
    expect(() => getStagingServiceRoleKey({ ...stageEnv, ...overrides }, { root: fixture(), execute })).toThrow('bloqueado');
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects a changed CLI link before any external invocation', () => {
    const execute = vi.fn(() => inventory);
    expect(() => getStagingServiceRoleKey(stageEnv, { root: fixture('exvjusubjjvjcdxtjfgf'), execute })).toThrow('Vínculo CLI');
    expect(execute).not.toHaveBeenCalled();
  });
  it('checks the admin and public credential against the staging inventory before mutation', () => {
    const root = fixture();
    const execute = vi.fn(() => inventory);
    expect(() => getStagingServiceRoleKey({ ...stageEnv, SUPABASE_SERVICE_ROLE_KEY: 'production-service' }, { root, execute })).toThrow('Credencial administrativa');
    expect(() => getStagingServiceRoleKey({ ...stageEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_production' }, { root, execute })).toThrow('Credencial pública');
    expect(getStagingServiceRoleKey(stageEnv, { root, execute })).toBe('fixture-service');
  });
  it.each([
    'postgres://postgres:secret@db.iwesoczokkycjovyknnz.supabase.co:5432/postgres?sslmode=verify-full',
    'postgres://postgres.iwesoczokkycjovyknnz:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
  ])('accepts identified staging direct and session pooler URLs', (DATABASE_URL) => {
    expect(() => assertStagingTarget({ ...stageEnv, DATABASE_URL }, { root: fixture() })).not.toThrow();
  });
  it('uses a Node CLI entrypoint and argument array, preserving paths with spaces across platforms', () => {
    const root = fixture();
    const execute = vi.fn((_file: string, _args: string[], _options: unknown) => 'ok');
    const sql = path.join(root, 'SQL with spaces.sql');
    expect(runSupabaseCli(['db', 'query', '--linked', '--project-ref', STAGING_PROJECT_REF, '--file', sql], { root, env: stageEnv, execute })).toBe('ok');
    expect(execute).toHaveBeenCalledWith(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), 'db', 'query', '--linked', '--project-ref', STAGING_PROJECT_REF, '--file', sql], expect.objectContaining({ env: stageEnv }));
    expect(execute.mock.calls[0][2]).not.toHaveProperty('shell');
  });
  it.each([
    ['db', 'query', '--linked', '--project-ref=exvjusubjjvjcdxtjfgf'],
    ['db', 'query', '--linked', '--project-ref', STAGING_PROJECT_REF, '--db-url=postgres://production'],
    ['config', 'push', '--project-ref', STAGING_PROJECT_REF],
  ])('refuses alternate CLI targets or commands before spawning a subprocess', (...args) => {
    const execute = vi.fn(() => 'unexpected');
    expect(() => runSupabaseCli(args, { root: fixture(), env: stageEnv, execute })).toThrow('Argumentos CLI');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['test-db-cloud.mjs', 'test-auth-cloud.mjs', 'test-repository-cloud.mjs'])('entrypoint %s refuses production with no Cloud work', (name) => {
    const result = spawnSync(process.execPath, [path.resolve('scripts', name)], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, SUPABASE_PROJECT_REF: 'exvjusubjjvjcdxtjfgf' }, timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Apenas fincontrol-staging');
  });
});
