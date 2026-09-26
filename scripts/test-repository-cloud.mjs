import { execSync } from 'child_process';
import path from 'path';

console.log('================================================================');
console.log('  TESTE DE INTEGRAÇÃO DO REPOSITÓRIO NO SUPABASE CLOUD (Staging)');
console.log('  Modo: 100% via Token Criptográfico (Sem envio SMTP / Sem Bounces)');
console.log('================================================================\n');

try {
  const env = { ...process.env, TEST_CLOUD: 'true' };
  execSync(
    'cmd /c npx vitest run src/lib/__tests__/repositories/cloud-repository.integration.test.ts',
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env,
    }
  );
  console.log('\n[PASS] Todos os testes de integração do repositório no Supabase Cloud passaram com sucesso!');
} catch (err) {
  console.error('\n[FAIL] Falha na execução dos testes de integração do repositório no Supabase Cloud.');
  process.exit(1);
}
