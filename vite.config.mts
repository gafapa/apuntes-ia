import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Puertos configurables para poder tener a la vez la app en vivo y una instancia de pruebas
const API = `http://127.0.0.1:${process.env.APUNTES_PUERTO ?? 4317}`;

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist-web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: Number(process.env.APUNTES_PUERTO_WEB ?? 5173),
    proxy: {
      '/api': API,
      '/datos': API,
      '/ws': { target: API, ws: true },
    },
  },
});
