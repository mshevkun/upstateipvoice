import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  publicDir: 'planner/public',
  base: command === 'build' ? '/planner/' : '/',
  plugins: [
    react(),
    {
      name: 'planner-index',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/planner' || req.url === '/planner/' || req.url === '/planner/index.html') {
            req.url = '/planner/dev.html';
          }
          next();
        });
      },
    },
  ],
  appType: 'mpa',
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api/public/planner': {
        target: 'https://app.upstateipvoice.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  optimizeDeps: {
    entries: ['planner/src/main.tsx'],
  },
  build: {
    outDir: 'planner/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: 'planner/dev.html',
      output: {
        manualChunks: (id: string) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
}));
