import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/financial-engine/**/*.ts',
        'src/lib/utils.ts',
        'src/lib/context/finance-context.tsx',
        'src/lib/context/finance-storage.ts',
        'src/lib/context/actions/**/*.ts',
        'src/components/transactions/QuickAddModal.tsx',
        'src/components/transactions/quick-add/**/*.tsx',
        'src/components/transactions/PaymentModal.tsx',
        'src/app/**/splits/page.tsx',
        'src/components/splits/**/*.tsx',
        'src/lib/repositories/**/*.ts',
      ],
      exclude: [
        'src/lib/financial-engine/index.ts',
        'src/lib/context/actions/index.ts',
        'src/lib/context/actions/types.ts',
        'src/lib/repositories/index.ts',
        'src/lib/repositories/mappers/index.ts',
        'src/lib/repositories/finance-repository.ts',
      ],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 98.5,
        branches: 97.0,
        functions: 100,
        lines: 99.0,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
