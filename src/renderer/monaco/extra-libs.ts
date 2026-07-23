/**
 * Layer 2: MongoDB driver type declarations (ADR-07).
 * The manifest is generated at build time by scripts/extract-mongo-types.mjs
 * from the INSTALLED mongodb/bson packages — never hand-maintained.
 */
import { typescript as monacoTs } from 'monaco-editor';

interface TypeManifest {
  key: string;
  files: Array<{ path: string; content: string }>;
  globals: string;
}

export async function loadMongoTypeLibs(): Promise<void> {
  let manifest: TypeManifest;
  try {
    manifest = (await import('../generated/mongo-types.manifest.json')) as unknown as TypeManifest;
  } catch {
    // Manifest not generated yet (run `npm run extract:types`): editor still
    // works, just without driver completions.
    console.warn('[MongoG] mongo-types manifest missing; driver completions disabled.');
    return;
  }

  const defaults = [monacoTs.typescriptDefaults, monacoTs.javascriptDefaults];
  for (const d of defaults) {
    for (const file of manifest.files) {
      d.addExtraLib(file.content, file.path);
    }
    d.addExtraLib(manifest.globals, 'file:///mongog/globals.d.ts');
  }
}
