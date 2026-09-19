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
        'src/lib/financial-engine.ts',
        'src/lib/utils.ts',
        'src/lib/context/finance-context.tsx',
        'src/components/transactions/QuickAddModal.tsx',
        'src/components/transactions/PaymentModal.tsx',
        'src/app/**/splits/page.tsx',
      ],
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
