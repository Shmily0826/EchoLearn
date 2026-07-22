import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ prefixed) for the dev proxy
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'EchoLearn — YouTube English Learning',
          short_name: 'EchoLearn',
          description:
            'Learn English from YouTube videos with AI-powered transcript analysis, vocabulary extraction, and spaced repetition.',
          theme_color: '#863bff',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // social-preview.png is only for social-media link crawlers, not the app UI —
          // keep it out of the precache so users don't download ~716KB needlessly.
          globIgnores: ['**/social-preview.png'],
          runtimeCaching: [
            {
              // AI analysis requests go through the same-origin proxy
              urlPattern: /\/api\/ai.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'ai-api',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              // Cache YouTube proxy responses (same-origin /api/yt)
              urlPattern: /\/api\/yt.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'youtube-proxy',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 2 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
      }),
    ],
    build: {
      // Strip console.* and debugger from production builds (kept in dev for debugging).
      // Vite 8 uses rolldown/oxc which doesn't expose drop_console, so use terser here.
      minify: mode === 'production' ? 'terser' : 'oxc',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          // Split heavy vendor libs into separate chunks for parallel download + caching
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
                return 'vendor-charts';
              }
              if (id.includes('firebase') || id.includes('@firebase')) {
                return 'vendor-firebase';
              }
            }
          },
        },
      },
    },
    server: {
      proxy: {
        // Proxy YouTube requests to bypass CORS in dev mode
        '/yt-proxy': {
          target: 'https://www.youtube.com',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/yt-proxy/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, _req) => {
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              console.log(
                `[yt-proxy] ${req.method} ${req.url?.substring(0, 80)} → ${proxyRes.statusCode}`,
              );
            });
            proxy.on('error', (err, req) => {
              console.error(`[yt-proxy] ERROR ${req.url?.substring(0, 80)}:`, err.message);
            });
          },
        },
        // Proxy DeepSeek AI requests in dev mode (API key injected server-side)
        '/api/ai': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (env.DEEPSEEK_API_KEY) {
                proxyReq.setHeader('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`);
              }
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              console.log(
                `[ai-proxy] ${req.method} → ${proxyRes.statusCode}`,
              );
            });
          },
        },
      },
    },
  };
});
