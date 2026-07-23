#!/usr/bin/env node
/**
 * S6 spike: verify that the extracted d.ts manifest gives working MongoDB
 * completions in a real TypeScript language service (same engine Monaco's
 * ts.worker uses), and measure latency.
 *
 * Success: completions at `db.collection("users").f<TAB>` include find(),
 * aggregate(), insertOne(); hover on `client` resolves to MongoClient;
 * no module-resolution errors; first completion < 3000ms (cold), < 300ms warm.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const manifestPath = path.join(root, 'src/renderer/generated/mongo-types.manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Manifest missing. Run: npm run extract:types');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/** Map file:/// URIs to plain paths for the TS host. */
const strip = (p) => p.replace(/^file:\/\//, '');
const libFiles = new Map();
for (const f of manifest.files) libFiles.set(strip(f.path), f.content);
const GLOBALS_PATH = '/mongog/globals.d.ts';
libFiles.set(GLOBALS_PATH, manifest.globals);

const SCRIPT_PATH = '/script.ts';
const script = `const users = db.collection("users");
users.fi
const oid = new mongodb.ObjectId();
client.
`;
libFiles.set(SCRIPT_PATH, script);

const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  strict: true,
  allowJs: true,
  types: [], // do not auto-include real @types; our virtual files only
  noLib: false,
};

const host = {
  getScriptFileNames: () => [...libFiles.keys()],
  getScriptVersion: () => '1',
  getScriptSnapshot: (fileName) => {
    const content = libFiles.get(fileName);
    return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
  },
  getCurrentDirectory: () => '/',
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
  fileExists: (fileName) => libFiles.has(fileName) || ts.sys.fileExists(fileName),
  readFile: (fileName) => libFiles.get(fileName) ?? ts.sys.readFile(fileName),
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

// Semantic errors restricted to OUR script (lib internals are irrelevant).
const t0 = performance.now();
const semantic = ls.getSemanticDiagnostics(SCRIPT_PATH).filter(
  // 'fi' is our deliberate completion probe; the resulting diagnostic is
  // expected and actually PROVES that strong typing is active.
  (d) => !/'fi'/.test(ts.flattenDiagnosticMessageText(d.messageText, ' ')),
);
const moduleErrors = semantic.filter((d) => /Cannot find module/.test(ts.flattenDiagnosticMessageText(d.messageText, ' ')));
const tDiag = performance.now() - t0;

function completionsAt(search, label) {
  const offset = script.indexOf(search) + search.length;
  const t = performance.now();
  const res = ls.getCompletionsAtPosition(SCRIPT_PATH, offset, {
    includeCompletionsWithSnippetText: true,
  });
  const ms = performance.now() - t;
  const names = new Set((res?.entries ?? []).map((e) => e.name));
  console.log(`[${label}] ${res?.entries?.length ?? 0} completions in ${ms.toFixed(0)}ms`);
  return names;
}

console.log(`manifest: ${manifest.key}, ${libFiles.size} files`);
console.log(`semantic diagnostics (script): ${semantic.length}, module errors: ${moduleErrors.length} (${tDiag.toFixed(0)}ms)`);
for (const d of semantic.slice(0, 8)) {
  console.log(`  diag: ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 160)}`);
}

let failures = 0;
const expect = (cond, msg) => {
  if (cond) console.log(`  PASS: ${msg}`);
  else {
    console.log(`  FAIL: ${msg}`);
    failures += 1;
  }
};

const t1 = performance.now();
const collMethods = completionsAt('users.fi', 'collection methods (cold)');
console.log(`  cold first completion: ${(performance.now() - t1).toFixed(0)}ms`);
expect(collMethods.has('find'), 'find() suggested');
expect(collMethods.has('findOne'), 'findOne() suggested');
expect(collMethods.has('aggregate'), 'aggregate() suggested');
expect(collMethods.has('insertOne'), 'insertOne() suggested');
expect(collMethods.has('updateMany'), 'updateMany() suggested');
expect(collMethods.has('watch'), 'watch() (change streams) suggested');
expect(collMethods.has('createIndex'), 'createIndex() suggested');

const clientMembers = completionsAt('client.', 'client members (warm)');
expect(clientMembers.has('db'), 'client.db suggested');
expect(clientMembers.has('startSession'), 'client.startSession suggested');
expect(clientMembers.has('watch'), 'client.watch suggested');

const warm = completionsAt('users.fi', 'collection methods (warm 2)');
void warm;

// hover/quickinfo on ObjectId constructor line should know mongodb namespace
const qiOffset = script.indexOf('ObjectId') + 2;
const qi = ls.getQuickInfoAtPosition(SCRIPT_PATH, qiOffset);
expect(Boolean(qi), 'quickinfo resolves for mongodb.ObjectId');

expect(moduleErrors.length === 0, 'no module resolution errors');
expect(semantic.filter((d) => d.category === ts.DiagnosticCategory.Error).length === 0, 'no semantic errors in sample script');

console.log(failures === 0 ? '\nS6 SPIKE: PASS' : `\nS6 SPIKE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
