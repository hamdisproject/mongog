import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { buildAutoAwaitProjection, mapAutoAwaitResult } from '../../../src/features/script-analysis/auto-await-projection.js';

function languageService(source: string) {
  const projection = buildAutoAwaitProjection(source);
  const filename = '/query.ts';
  const manifest = JSON.parse(readFileSync('src/renderer/generated/mongo-types.manifest.json', 'utf8')) as { files: { path: string; content: string }[]; globals: string };
  const files = new Map(manifest.files.map(file => [file.path.replace(/^file:\/\//, ''), file.content]));
  files.set('/mongog/globals.d.ts', manifest.globals);
  files.set(filename, projection.source);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()], getScriptVersion: () => '1',
    getScriptSnapshot: name => { const text = files.get(name) ?? ts.sys.readFile(name); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, strict: true, types: [], skipLibCheck: true }),
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: name => files.has(name) || ts.sys.fileExists(name),
    readFile: name => files.get(name) ?? ts.sys.readFile(name),
  };
  return { projection, filename, service: ts.createLanguageService(host) };
}
const messages = (diagnostics: readonly ts.Diagnostic[]) => diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'));

describe('automatic-await language projection', () => {
  it('retains real driver types for awaited reads, callbacks, helpers and cursor loops', () => {
    const source = `
      const users = db.collection<{name: string; active: boolean}>("users");
      const user = users.findOne({name:'Ada'});
      user?.name.toUpperCase();
      if (users.countDocuments({active:true}) > 0) print('active');
      function name() { return users.findOne({}); }
      name()?.name.toUpperCase();
      [1,2].map(() => users.findOne({}))[0]?.name;
      [1,2].map(async () => users.findOne({}))[0]?.name;
      [1,2].reduce(async (n,x) => n+users.countDocuments({}),0).toFixed();
      [1,2].flatMap(async () => [users.findOne({})])[0]?.name;
      for (const user of users.find({})) print(user.name);
      users.findOne({}).then(user => user?.name);
      const session=client.startSession();
      session.withTransaction(() => { users.insertOne({name:"A",active:true}, {session}); });
      const { active } = { active: users.countDocuments({}) > 0 }; print(active);
    `;
    const {service, filename} = languageService(source);
    expect(messages(service.getSyntacticDiagnostics(filename))).toEqual([]);
    expect(messages(service.getSemanticDiagnostics(filename))).toEqual([]);
    service.dispose();
  });

  it('maps each original character through the virtual source without changing source text', () => {
    const source = 'const user = db.collection("users").findOne({});\nuser?.name;';
    const projection = buildAutoAwaitProjection(source);
    for (const mapping of projection.mappings) {
      expect(projection.source.slice(mapping.generatedStart, mapping.generatedStart + mapping.length))
        .toBe(source.slice(mapping.originalStart, mapping.originalStart + mapping.length));
      for (let i = 0; i < mapping.length; i++) expect(projection.toOriginal(mapping.generatedStart + i)).toBe(mapping.originalStart + i);
    }
    expect(projection.toOriginal(0)).toBeUndefined();
  });

  it('removes synthetic navigation and hover entries instead of emitting missing required spans', () => {
    const source='const item=db.collection("users").findOne({}); item?.name;';
    const {service,projection,filename}=languageService(source);
    const mapped=mapAutoAwaitResult(service.getNavigationTree(filename),filename,()=>projection) as ts.NavigationTree;
    expect(mapped.childItems?.map(item=>item.text)).toEqual(['item']);
    expect(mapped.childItems?.every(item=>item.spans.length>0)).toBe(true);
    expect(mapAutoAwaitResult({textSpan:{start:5,length:3},displayParts:[]}, filename,()=>projection)).toBeUndefined();
    service.dispose();
  });

  it('completes document fields and maps genuine type errors to original locations', () => {
    const source = `const users=db.collection<{name:string}>("users"); const user=users.findOne({});\nuser?.noSuchField;\nuser?.na`;
    const {service, projection, filename} = languageService(source);
    const completions = service.getCompletionsAtPosition(filename, projection.toGenerated(source.length), {});
    expect(completions?.entries.map(entry=>entry.name)).toContain('name');
    const diagnostics = service.getSemanticDiagnostics(filename);
    const error = diagnostics.find(item=>ts.flattenDiagnosticMessageText(item.messageText, ' ').includes('noSuchField'));
    expect(error).toBeDefined();
    expect(projection.toOriginal(error!.start!)).toBe(source.indexOf('noSuchField'));
    service.dispose();
  });
});
