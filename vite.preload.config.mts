import { defineConfig } from 'vite';

// Preload MUST stay CommonJS: sandboxed preload scripts cannot use ESM.
// Only the electron module is importable in a sandboxed preload.
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
    },
  },
});
