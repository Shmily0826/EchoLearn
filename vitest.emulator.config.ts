import { defineConfig } from 'vitest/config';

// The Firestore emulator port is 8080 by default (firebase.json). On a machine
// where that port is already taken, run the suite against a scratch config on
// another port and point the tests at it with ECHOLEARN_EMULATOR_HOST — the
// Firebase CLI executes its inner command through cmd.exe on Windows, where
// `VAR=value cmd` is not valid syntax, so the host has to come from here.
const emulatorHost = process.env.ECHOLEARN_EMULATOR_HOST;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/services/__tests__/firestoreRules*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    ...(emulatorHost ? { env: { FIRESTORE_EMULATOR_HOST: emulatorHost } } : {}),
  },
});
