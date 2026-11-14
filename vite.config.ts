import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The same dist must work at a domain root and a repository subdirectory.
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { proxy: { '/api/ai': 'http://127.0.0.1:8787' } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom'], media: ['mediabunny'] } },
    },
  },
});
