import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Electron already ships this exact UI inside the application. Registering a
      // service worker there can leave an upgraded renderer talking to an older local
      // server/preload bridge (or the reverse), which presents as missing native
      // buttons and 404s for newly added API routes. Browser clients still register
      // the generated worker explicitly in main.tsx.
      injectRegister: null,
      // Everything is bundled and same-origin — no CDN, no external font — so an
      // offline load is indistinguishable from an online one.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // API responses are not cached here: the library lives in IndexedDB, which is
        // queryable. A stale HTTP cache would only compete with it and win sometimes.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws$/],
      },
      manifest: {
        name: 'Worship Archive',
        short_name: 'Worship',
        description: 'Cântări pentru trupa de închinare — funcționează fără internet',
        lang: 'ro',
        start_url: '/',
        display: 'standalone',
        background_color: '#16181a',
        theme_color: '#16181a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 7373,
    proxy: {
      '/api': { target: 'http://localhost:7374', changeOrigin: true },
      // ws:true — without it the live session silently never connects in development.
      '/ws': { target: 'ws://localhost:7374', ws: true },
    },
  },
});
