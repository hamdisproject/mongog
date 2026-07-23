import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Optional/lazily-required driver dependencies must stay external.
// The driver requires them inside try/catch at runtime; they are peer-optional.
// (mongodb-connection-string-url and @mongodb-js/saslprep are HARD deps and
// must NOT be externalized — they get bundled in.)
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

// Query runtime: executed via utilityProcess.fork(). Built as a single
// self-contained CommonJS file (fork-compatible, no ESM ambiguity).
// mongodb + bson are bundled IN so the runtime never resolves node_modules
// from inside/outside the asar archive.
export default defineConfig({
  build: {
    // Separate dir OUTSIDE .vite: plugin-vite wipes .vite before its builds.
    // Kept in the package via packagerConfig.ignore (forge.config.mts).
    outDir: 'runtime-dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'node22',
    minify: false,
    lib: {
      entry: 'src/query-runtime/index.ts',
      formats: ['cjs'],
      fileName: () => 'query-runtime.cjs',
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...optionalDriverDeps],
    },
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'main'],
  },
});
