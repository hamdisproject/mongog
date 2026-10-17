import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Monaco ships its own ESM; pre-bundling it breaks worker resolution.
    exclude: ['monaco-editor'],
  },
  build: {
    // Renderer maps were ~93 MB inside app.asar (3x the JS) and nothing consumes them.
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
});
