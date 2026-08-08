import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Optional/lazily-required driver deps (see vite.runtime.config.mts).
const optionalDriverDeps = [
  'kerberos',
  'snappy',
  '@mongodb-js/zstd',
  'mongodb-client-encryption',
  'gcp-metadata',
  'aws4',
  'socks',
  'os-dns-native',
  '@aws-sdk/credential-providers',
];

// Main process bundle. package.json is "type": "module", so the output MUST
// be ESM — plugin-vite otherwise defaults the main lib build to CJS.
export default defineConfig({
  // TypeScript is loaded lazily by the data-only Documents criteria parser.
  // Its CommonJS compatibility path references these Node globals; provide
  // ESM-safe equivalents for the generated lazy chunk.
  define: {
    __filename: 'import.meta.filename',
    __dirname: 'import.meta.dirname',
  },
  build: {
    sourcemap: true,
    lib: {
      entry: 'src/main/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'mongodb-memory-server',
        ...optionalDriverDeps,
        ...nodeBuiltins,
      ],
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'main'],
  },
});
