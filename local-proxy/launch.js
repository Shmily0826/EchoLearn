/**
 * EchoLearn — Local Proxy + Cloudflare Tunnel Launcher
 *
 * Starts the Express proxy server and a cloudflared quick tunnel,
 * then displays the public tunnel URL for use with EchoLearn.
 *
 * Usage:
 *   node launch.js
 */

import { spawn } from 'child_process';
import { createServer } from 'net';
import { existsSync } from 'fs';

const PORT = parseInt(process.env.PORT || '8787', 10);

// ── Find cloudflared binary ──────────────────────────────────
function findCloudflared() {
  // Try common install locations on Windows
  const candidates = [
    'cloudflared', // PATH
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    `${process.env.LOCALAPPDATA}\\cloudflared\\cloudflared.exe`,
    `${process.env.USERPROFILE}\\cloudflared\\cloudflared.exe`,
  ];

  for (const candidate of candidates) {
    if (candidate === 'cloudflared') continue; // skip PATH check for now
    if (existsSync(candidate)) return candidate;
  }

  // Fall back to PATH (will throw ENOENT if not found)
  return 'cloudflared';
}

// ── Step 1: Find an available port ───────────────────────────
function findPort(start) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findPort(start + 1));
      } else {
        reject(err);
      }
    });
  });
}

// ── Step 2: Start the proxy server ───────────────────────────
function startProxy(port) {
  return new Promise((resolve) => {
    const proxy = spawn('node', ['server.js'], {
      cwd: import.meta.dirname,
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proxy.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      // Server is ready when it prints the listening message
      if (text.includes('Listening on')) {
        resolve(proxy);
      }
    });

    proxy.stderr.on('data', (data) => {
      // Filter out the TLS warning
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

// ── Step 3: Start cloudflared tunnel ─────────────────────────
function startTunnel(port) {
  const cloudflaredPath = findCloudflared();

  return new Promise((resolve) => {
    const tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let tunnelUrl = null;

    const handleOutput = (data) => {
      const text = data.toString();

      // Look for the tunnel URL in cloudflared output
      const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0];
        resolve({ process: tunnel, url: tunnelUrl });
      }
    };

    tunnel.stdout.on('data', handleOutput);
    tunnel.stderr.on('data', handleOutput);

    tunnel.on('error', (err) => {
      if (!tunnelUrl) {
        console.log(`\ncloudflared error: ${err.message}`);
        if (err.code === 'ENOENT') {
          console.log('cloudflared not found. Install: winget install Cloudflare.cloudflared');
        }
        console.log('Proxy is still running on localhost (no tunnel).');
        resolve({ process: tunnel, url: null });
      }
    });

    tunnel.on('exit', (code) => {
      if (!tunnelUrl) {
        console.log(`\ncloudflared exited (code ${code})`);
        console.log('Tunnel failed to start. Proxy is still running on localhost.');
      }
    });

    // Timeout: if tunnel doesn't start in 30 seconds, continue anyway
    setTimeout(() => {
      if (!tunnelUrl) {
        resolve({ process: tunnel, url: null });
      }
    }, 30000);
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  EchoLearn Local Proxy + Tunnel Launcher');
  console.log('  ========================================');
  console.log('');

  // Find available port
  const port = await findPort(PORT);
  if (port !== PORT) {
    console.log(`  Port ${PORT} is busy, using ${port} instead.`);
  }

  // Start proxy
  console.log('  Starting proxy server...');
  await startProxy(port);

  // Start tunnel
  console.log('');
  console.log('  Starting Cloudflare Tunnel...');
  const { url: tunnelUrl } = await startTunnel(port);

  // Display results
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   EchoLearn Local Proxy is RUNNING            │');
  console.log('  ├──────────────────────────────────────────────┤');
  console.log(`  │   Local:  http://127.0.0.1:${port}             │`);

  if (tunnelUrl) {
    // Pad URL line nicely
    const urlLine = `  │   Public: ${tunnelUrl}`;
    const padding = 50 - tunnelUrl.length;
    console.log(urlLine + ' '.repeat(Math.max(0, padding)) + '│');
    console.log('  │                                              │');
    console.log('  │   Use the PUBLIC URL in EchoLearn Settings   │');
    console.log('  │   to access from any device!                 │');
  } else {
    console.log('  │   Public: (tunnel unavailable)               │');
    console.log('  │                                              │');
    console.log('  │   Use http://127.0.0.1:' + port + ' in Settings  │');
    console.log('  │   (works only on this computer)              │');
  }

  console.log('  │                                              │');
  console.log('  │   Press Ctrl+C to stop.                      │');
  console.log('  └──────────────────────────────────────────────┘');
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
