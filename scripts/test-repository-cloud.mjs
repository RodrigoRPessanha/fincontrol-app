import { execFileSync } from 'node:child_process';
import path from 'path';
import { loadCloudEnvironment, getStagingServiceRoleKey } from './cloud-test-safety.mjs';

console.log('================================================================');
console.log('  TESTE DE INTEGRAÇÃO DO REPOSITÓRIO NO SUPABASE CLOUD (Staging)');
console.log('  Modo: 100% via Token Criptográfico (Sem envio SMTP / Sem Bounces)');
console.log('================================================================\n');

try {
  const env = { ...loadCloudEnvironment(), TEST_CLOUD: 'true' };
  // Validate supplied credentials before Vitest can execute any setup hook.
  getStagingServiceRoleKey(env);
  execFileSync(process.execPath, [path.resolve('node_modules/vitest/vitest.mjs'), 'run',
    'src/lib/__tests__/repositories/cloud-repository.integration.test.ts',
    'src/lib/__tests__/finance-provider/cloud-provider.integration.test.tsx',
    'src/lib/__tests__/finance-provider/cloud-recovery.integration.test.tsx',
    'src/lib/__tests__/finance-provider/cloud-analytics.integration.test.tsx', '--no-file-parallelism'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env,
  });
  console.log('\n[PASS] Todos os testes de integração do repositório e Provider no Supabase Cloud passaram com sucesso!');
} catch (err) {
  console.error('\n[FAIL] Falha na execução dos testes de integração no Supabase Cloud.');
  console.error(err.message);
  process.exit(1);
}
