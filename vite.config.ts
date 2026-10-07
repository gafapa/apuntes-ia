import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = 'http://127.0.0.1:4317';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist-web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/datos': API,
      '/ws': { target: API, ws: true },
    },
  },
});
