import { loadCloudEnvironment, assertStagingTarget } from './cloud-test-safety.mjs';
try {
  assertStagingTarget(loadCloudEnvironment(), { requireApi: true, requireLink: !process.argv.includes('--before-link') });
  console.log('Destino de testes confirmado: fincontrol-staging.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
