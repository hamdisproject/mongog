import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Monaco ships its own ESM; pre-bundling it breaks worker resolution.
    exclude: ['monaco-editor'],
  },
  build: {
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
