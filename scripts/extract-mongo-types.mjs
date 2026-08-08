#!/usr/bin/env node
/**
 * ADR-07: build-time extraction of the INSTALLED driver's .d.ts graph.
 *
 * Crawls mongodb.d.ts + bson (+ referenced node builtins / @types) and emits
 * src/renderer/generated/mongo-types.manifest.json containing virtual files
 * under file:///node_modules/... plus synthetic global declarations.
 *
 * The manifest is keyed by package versions; it is regenerated whenever the
 * driver/bson/monaco versions change (prestart/prepackage hooks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const OUT = path.join(root, 'src/renderer/generated/mongo-types.manifest.json');

/** virtualPath -> content */
const files = new Map();
const visited = new Set();

function pkgInfo(spec) {
  // 1) Direct node_modules lookup: robust for @types/* and packages whose
  //    "exports" map hides ./package.json.
  const direct = path.join(root, 'node_modules', spec, 'package.json');
  if (fs.existsSync(direct)) {
    return { pkgJsonPath: direct, dir: path.dirname(direct), pkg: JSON.parse(fs.readFileSync(direct, 'utf8')) };
  }
  // 2) Resolve the entry point and walk up to the package root.
  const entry = require.resolve(spec, { paths: [root] });
  let dir = path.dirname(entry);
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === spec) return { pkgJsonPath: candidate, dir, pkg };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot locate package root for ${spec}`);
}

function typesEntryOf(spec) {
  const { dir, pkg } = pkgInfo(spec);
  let t = pkg.types ?? pkg.typings;
  if (!t && pkg.exports) {
    const exp = pkg.exports['.'];
    if (exp && typeof exp === 'object') {
      t = exp.types ?? exp['import']?.types ?? exp['require']?.types;
    }
  }
  t ??= 'index.d.ts';
  let p = path.join(dir, t);
  if (!fs.existsSync(p) && fs.existsSync(`${p}.d.ts`)) p = `${p}.d.ts`;
  if (!fs.existsSync(p)) throw new Error(`No .d.ts entry for ${spec}`);
  return { pkgName: spec, pkgDir: dir, absPath: p, version: pkg.version };
}

function toVirtual(pkgName, pkgDir, absPath) {
  const rel = path.relative(pkgDir, absPath).split(path.sep).join('/');
  return `file:///node_modules/${pkgName}/${rel}`;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
const REF_PATH_RE = /\/\/\/\s*<reference\s+path="([^"]+)"/g;
const REF_TYPES_RE = /\/\/\/\s*<reference\s+types="([^"]+)"/g;

function specifiersOf(content) {
  const specs = [];
  for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE, REF_PATH_RE, REF_TYPES_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** Resolve a bare specifier to a d.ts file we can embed. */
function resolveBare(spec) {
  const name = spec.replace(/^node:/, '');
  // 1) explicit packages we know (mongodb, bson)
  if (name === 'mongodb' || name === 'bson') return typesEntryOf(name);
  // 2) node builtin -> @types/node/<name>.d.ts
  try {
    const { dir } = pkgInfo('@types/node');
    const p = path.join(dir, `${name}.d.ts`);
    if (fs.existsSync(p)) return { pkgName: '@types/node', pkgDir: dir, absPath: p };
  } catch { /* fall through */ }
  // 3) package with its own types (e.g. undici-types, whatwg-url)
  try {
    return typesEntryOf(name);
  } catch { /* fall through */ }
  // 4) @types/<name>
  try {
    return typesEntryOf(`@types/${name}`);
  } catch {
    return null;
  }
}

function resolveRelative(spec, fromAbs, pkgName, pkgDir) {
  let p = path.resolve(path.dirname(fromAbs), spec);
  const candidates = [p, `${p}.d.ts`, `${p}.ts`, path.join(p, 'index.d.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && c.endsWith('.d.ts')) {
      return { pkgName, pkgDir, absPath: c };
    }
  }
  return null;
}

function addFile({ pkgName, pkgDir, absPath }) {
  const virtual = toVirtual(pkgName, pkgDir, absPath);
  if (visited.has(virtual)) return;
  visited.add(virtual);
  const content = fs.readFileSync(absPath, 'utf8');
  files.set(virtual, content);
  for (const spec of specifiersOf(content)) {
    const resolved = spec.startsWith('.')
      ? resolveRelative(spec, absPath, pkgName, pkgDir)
      : resolveBare(spec);
    if (resolved) addFile(resolved);
  }
}

function wrapAsAmbientModule(virtual, moduleName) {
  const content = files.get(virtual);
  if (!content) return;
  // IMPORTANT: do NOT add top-level import/export here. In a script file,
  // `declare module "x"` is an ambient module declaration; in a module file
  // it becomes a (failing) module augmentation.
  files.set(virtual, `declare module "${moduleName}" {\n${content}\n}\n`);
}

// --- crawl -----------------------------------------------------------------
const mongodbEntry = typesEntryOf('mongodb');
const bsonEntry = typesEntryOf('bson');
addFile(mongodbEntry);
addFile(bsonEntry);

// Ambient-module wrapping makes `import("mongodb")` resolvable WITHOUT a
// virtual package.json / node_modules layout (Monaco worker friendly).
wrapAsAmbientModule(toVirtual(mongodbEntry.pkgName, mongodbEntry.pkgDir, mongodbEntry.absPath), 'mongodb');
wrapAsAmbientModule(toVirtual(bsonEntry.pkgName, bsonEntry.pkgDir, bsonEntry.absPath), 'bson');

const globals = `
declare const mongodb: typeof import('mongodb');
declare const bson: typeof import('bson');
declare const client: import('mongodb').MongoClient;
type MongoGShellDb = import('mongodb').Db & {
  getSiblingDB(databaseName: string): MongoGShellDb;
};
declare let db: MongoGShellDb;
declare function use(databaseName: string): MongoGShellDb;
declare const ObjectId: {
  (inputId?: string): import('bson').ObjectId;
  new (inputId?: string): import('bson').ObjectId;
  isValid(input: string): boolean;
};
declare function ISODate(value?: string): Date;
declare function Int32(value?: number | string): import('bson').Int32;
declare function NumberInt(value?: number | string): import('bson').Int32;
declare function Long(value?: number | string): import('bson').Long;
declare function NumberLong(value?: number | string): import('bson').Long;
declare function Double(value?: number | string): import('bson').Double;
declare function Decimal128(value?: string): import('bson').Decimal128;
declare function NumberDecimal(value?: string): import('bson').Decimal128;
declare function BinData(subtype: number, base64: string): import('bson').Binary;
declare function UUID(value?: string): import('bson').UUID;
declare function BSONRegExp(pattern: string, options?: string): import('bson').BSONRegExp;
declare function Timestamp(value: { t: number; i: number } | number, increment?: number): import('bson').Timestamp;
declare function MinKey(): import('bson').MinKey;
declare function MaxKey(): import('bson').MaxKey;
declare function DBRef(collection: string, id: import('bson').ObjectId, database?: string, fields?: import('bson').Document): import('bson').DBRef;
declare function Code(code: string, scope?: import('bson').Document): import('bson').Code;
declare function BSONSymbol(value: string): import('bson').BSONSymbol;
declare function print(...values: unknown[]): void;
declare function printjson(value: unknown): void;
`;

const manifest = {
  key: `mongodb@${mongodbEntry.version}+bson@${bsonEntry.version}`,
  generatedAt: new Date().toISOString(),
  files: [...files.entries()].map(([p, content]) => ({ path: p, content })),
  globals,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest));
const totalBytes = manifest.files.reduce((a, f) => a + f.content.length, 0);
console.log(
  `[extract-mongo-types] ${manifest.key}: ${manifest.files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB -> ${path.relative(root, OUT)}`,
);
