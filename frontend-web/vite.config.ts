import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/assets/prendas': {
        target: process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    // Mismo proxy que en desarrollo: permite previsualizar el build de producción
    // en local con el mismo comportamiento que el nginx de despliegue (location /api y /assets/prendas).
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/assets/prendas': {
        target: process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
