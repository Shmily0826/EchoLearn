import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/services/__tests__/firestoreRules.emulator.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
