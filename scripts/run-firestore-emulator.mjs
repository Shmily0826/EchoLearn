import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Keep Firebase CLI preferences out of a developer's normal profile. This is
// especially useful in restricted Windows environments where ~/.config may be
// read-only, and it makes the command independent from production credentials.
const configDir = join(tmpdir(), 'echolearn-firebase-cli-config');
mkdirSync(configDir, { recursive: true });

const cliPath = join(process.cwd(), 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');

// On a machine where the emulator's default 8080 is already taken, set
// ECHOLEARN_EMULATOR_HOST=127.0.0.1:<port> and this runner writes a scratch
// config next to the rules (the CLI refuses a rules file outside the project
// directory). The file is gitignored, and CI keeps the firebase.json path.
const altHost = process.env.ECHOLEARN_EMULATOR_HOST;
const args = [
  'emulators:exec',
  '--project',
  'echolearn-emulator',
  '--only',
  'firestore',
  'npm run test:emulator:run',
];
let scratchConfig = null;
if (altHost) {
  const port = new URL(`http://${altHost}`).port || '8080';
  scratchConfig = join(process.cwd(), 'firebase.emulator.local.json');
  writeFileSync(
    scratchConfig,
    `${JSON.stringify(
      { firestore: { rules: 'firestore.rules' }, emulators: { firestore: { port: Number(port) }, ui: { enabled: false } } },
      null,
      2,
    )}\n`,
  );
  args.splice(1, 0, '--config', 'firebase.emulator.local.json');
}

const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configDir,
  },
});

child.on('exit', (code, signal) => {
  if (scratchConfig) rmSync(scratchConfig, { force: true });
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to start Firebase Emulator: ${error.message}`);
  process.exit(1);
});
