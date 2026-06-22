import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.deepseek\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'deepseek-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // Proxy YouTube requests to bypass CORS in dev mode
      // Note: do NOT override headers here — the client code sets
      // appropriate User-Agent for InnerTube API (Android) vs page fetch.
      '/yt-proxy': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/yt-proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, _req) => {
            // Remove the host header set by the browser (localhost)
            // so the proxy sends youtube.com as the host
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            // Log proxy responses for debugging
            console.log(
              `[yt-proxy] ${req.method} ${req.url?.substring(0, 80)} → ${proxyRes.statusCode}`,
            );
          });
          proxy.on('error', (err, req) => {
            console.error(`[yt-proxy] ERROR ${req.url?.substring(0, 80)}:`, err.message);
          });
        },
      },
    },
  },
})
