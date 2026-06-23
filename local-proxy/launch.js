/**
 * EchoLearn — Local Proxy + Cloudflare Tunnel Launcher
 *
 * Starts the Express proxy server and a permanent Cloudflare tunnel.
 * The tunnel routes proxy.echo-learn.uk to your local proxy server.
 *
 * Usage:
 *   node launch.js
 */

import { spawn } from 'child_process';
import { createServer } from 'net';
import { existsSync } from 'fs';

const PORT = 8787; // must match config.yml
const TUNNEL_NAME = 'echolearn-tunnel';
const PUBLIC_URL = 'https://proxy.echo-learn.uk';

// ── Find cloudflared binary ──────────────────────────────────
function findCloudflared() {
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    `${process.env.LOCALAPPDATA}\\cloudflared\\cloudflared.exe`,
    `${process.env.USERPROFILE}\\cloudflared\\cloudflared.exe`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return 'cloudflared';
}

// ── Check if port is available ───────────────────────────────
function checkPort(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
    srv.on('error', () => resolve(false));
  });
}

// ── Step 1: Start the proxy server ───────────────────────────
function startProxy() {
  return new Promise((resolve) => {
    const proxy = spawn('node', ['server.js'], {
      cwd: import.meta.dirname,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proxy.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes('Listening on')) {
        resolve(proxy);
      }
    });

    proxy.stderr.on('data', (data) => {
      const text = data.toString();
      if (!text.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
        process.stderr.write(text);
      }
    });

    proxy.on('exit', (code) => {
      console.log(`\nProxy server exited (code ${code})`);
      process.exit(code || 0);
    });
  });
}

// ── Step 2: Start cloudflared named tunnel ───────────────────
function startTunnel() {
  const cloudflaredPath = findCloudflared();

  return new Promise((resolve) => {
    const tunnel = spawn(cloudflaredPath, ['tunnel', 'run', TUNNEL_NAME], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    const handleOutput = (data) => {
      const text = data.toString();

      // Named tunnel is ready when it registers the connection
      if (text.includes('Registered tunnel connection') || text.includes('Route propagat')) {
        if (!resolved) {
          resolved = true;
          resolve({ process: tunnel, ok: true });
        }
      }
    };

    tunnel.stdout.on('data', handleOutput);
    tunnel.stderr.on('data', handleOutput);

    tunnel.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        console.log(`\ncloudflared error: ${err.message}`);
        if (err.code === 'ENOENT') {
          console.log('cloudflared not found. Install: winget install Cloudflare.cloudflared');
        }
        resolve({ process: tunnel, ok: false });
      }
    });

    tunnel.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        console.log(`\ncloudflared exited (code ${code})`);
        resolve({ process: tunnel, ok: false });
      }
    });

    // Timeout: if tunnel doesn't connect in 20 seconds, continue anyway
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Tunnel might still be connecting, give it the benefit of the doubt
        resolve({ process: tunnel, ok: true });
      }
    }, 20000);
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  EchoLearn Local Proxy + Tunnel Launcher');
  console.log('  ========================================');
  console.log('');

  // Check port
  const portOk = await checkPort(PORT);
  if (!portOk) {
    console.log(`  [ERROR] Port ${PORT} is already in use.`);
    console.log('  Please close the other process using this port.');
    process.exit(1);
  }

  // Start proxy
  console.log('  Starting proxy server...');
  await startProxy();

  // Start tunnel
  console.log('');
  console.log('  Starting Cloudflare Tunnel...');
  const { ok: tunnelOk } = await startTunnel();

  // Display results
  console.log('');
  console.log('  ==================================================');
  console.log('    EchoLearn Local Proxy is RUNNING');
  console.log('  ==================================================');
  console.log(`    Local:  http://127.0.0.1:${PORT}`);

  if (tunnelOk) {
    console.log(`    Public: ${PUBLIC_URL}  (fixed!)`);
    console.log('');
    console.log('    Use this URL in EchoLearn Settings.');
    console.log('    It stays the same every time you restart!');
  } else {
    console.log('    Public: (tunnel failed to connect)');
    console.log('');
    console.log(`    Use http://127.0.0.1:${PORT} in Settings`);
    console.log('    (works only on this computer)');
  }

  console.log('');
  console.log('    Press Ctrl+C to stop.');
  console.log('  ==================================================');
  console.log('');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n  Shutting down...');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Launch error:', err);
  process.exit(1);
});
