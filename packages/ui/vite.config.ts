import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host:true so band devices on the LAN can reach the dev server, and the same 7373
  // the packaged app uses, so URLs people bookmark keep working.
  server: {
    host: true,
    port: 7373,
    proxy: { '/api': { target: 'http://localhost:7374', changeOrigin: true } },
  },
});
