import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Keep Firebase CLI preferences out of a developer's normal profile. This is
// especially useful in restricted Windows environments where ~/.config may be
// read-only, and it makes the command independent from production credentials.
const configDir = join(tmpdir(), 'echolearn-firebase-cli-config');
mkdirSync(configDir, { recursive: true });

const cliPath = join(process.cwd(), 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child = spawn(process.execPath, [
  cliPath,
  'emulators:exec',
  '--project',
  'echolearn-emulator',
  '--only',
  'firestore',
  'npm run test:emulator:run',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configDir,
  },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to start Firebase Emulator: ${error.message}`);
  process.exit(1);
});
