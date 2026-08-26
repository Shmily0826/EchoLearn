import { defineConfig } from 'vitest/config';

// Standalone test config, deliberately separate from vite.config.ts so the
// production build pipeline stays untouched. Unit tests run in a plain Node
// environment; the small browser surface src/utils/storage.ts needs
// (localStorage) is stubbed in src/test/setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src/services/__tests__/firestoreRules.emulator.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
