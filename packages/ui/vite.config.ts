import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Bind to every interface so band devices on the LAN can reach the dev server.
  server: { host: true, port: 7373 },
});
