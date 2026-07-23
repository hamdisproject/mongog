/**
 * Monaco bootstrap (plan §7). All assets are LOCAL (no CDN).
 * Layer 1 (TS language service) + Layer 2 (driver .d.ts manifest) are wired
 * here; Layers 3-4 (metadata/context completions) arrive in Phase 2/4.
 *
 * monaco-editor 0.56 exposes the TS language service API as the top-level
 * `typescript` namespace export (NOT monaco.languages.typescript anymore).
 */
import * as monaco from 'monaco-editor';
import { typescript as monacoTs } from 'monaco-editor';
// monaco-editor 0.56 has an "exports" map: deep imports need the .js suffix.
// ESM modules self-import their CSS; no separate stylesheet import is needed.
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { loadMongoTypeLibs } from './extra-libs.js';
import { registerSchemaCompletions } from './completions.js';

let booted = false;

export async function bootMonaco(): Promise<typeof monaco> {
  if (booted) return monaco;
  booted = true;

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };

  const compilerOptions: import('monaco-editor').typescript.CompilerOptions = {
    target: monacoTs.ScriptTarget.ESNext,
    module: monacoTs.ModuleKind.ESNext, // top-level await
    moduleResolution: monacoTs.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: false,
    strict: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    allowNonTsExtensions: true,
    esModuleInterop: true,
  };
  for (const defaults of [monacoTs.typescriptDefaults, monacoTs.javascriptDefaults]) {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    });
    defaults.setEagerModelSync(true);
  }

  await loadMongoTypeLibs();
  registerSchemaCompletions();
  return monaco;
}
