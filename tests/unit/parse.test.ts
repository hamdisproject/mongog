import { describe, expect, it } from 'vitest';
import { parseScript, statementAtOffset } from '../../src/features/script-analysis/index.js';

describe('parseScript statement detection', () => {
  it('splits top-level statements correctly', () => {
    const p = parseScript('const a = 1;\ndb.users.find();\nawait db.x.countDocuments({});');
    expect(p.statements).toHaveLength(3);
    expect(p.statements[0]!.kind).toBe('declaration');
    expect(p.statements[1]!.kind).toBe('expression');
    expect(p.statements[2]!.kind).toBe('expression');
    expect(p.diagnostics).toHaveLength(0);
  });

  it('handles semicolons inside strings', () => {
    const p = parseScript('const s = "a;b;c";\ndb.x.findOne({ q: "1;2" });');
    expect(p.statements).toHaveLength(2);
    expect(p.statements[1]!.text).toContain('"1;2"');
  });

  it('handles template literals with semicolons and braces', () => {
    const src = 'const t = `a;b${ { c: 1 } }`;\nprint(t);';
    const p = parseScript(src);
    expect(p.statements).toHaveLength(2);
    expect(p.statements[1]!.kind).toBe('expression');
  });

  it('handles regular expressions containing semicolons', () => {
    const p = parseScript('const re = /a;b{1,2}/g;\ndb.x.find({ f: re });');
    expect(p.statements).toHaveLength(2);
  });

  it('handles line and block comments', () => {
    const src = '// db.fake();\n/* db.alsoFake(); */\ndb.real();';
    const p = parseScript(src);
    expect(p.statements).toHaveLength(1);
    expect(p.statements[0]!.text).toBe('db.real();');
  });

  it('does not treat a leading object literal as an expression (JS block semantics)', () => {
    const p = parseScript('{ a: 1 };\ndb.x.find();');
    // `{ a: 1 }` is a Block (then an EmptyStatement) — never a captured result.
    expect(p.statements[0]!.kind).not.toBe('expression');
    expect(p.statements[1]!.kind).not.toBe('expression');
    expect(p.statements[2]!.kind).toBe('expression');
  });

  it('handles parenthesized object literals as expressions', () => {
    const p = parseScript('({ a: 1 });');
    expect(p.statements[0]!.kind).toBe('expression');
  });

  it('handles top-level await and async functions', () => {
    const src = 'const f = async () => { await db.x.insertOne({}); };\nawait f();';
    const p = parseScript(src);
    expect(p.statements).toHaveLength(2);
    expect(p.diagnostics).toHaveLength(0);
  });

  it('handles loops and function bodies with internal semicolons', () => {
    const src = 'for (let i = 0; i < 3; i++) { print(i); }\nfunction g() { return 1; }\ndb.x.find();';
    const p = parseScript(src);
    expect(p.statements).toHaveLength(3);
    expect(p.statements[0]!.kind).toBe('control');
    expect(p.statements[1]!.kind).toBe('declaration');
    expect(p.statements[2]!.kind).toBe('expression');
  });

  it('handles TypeScript syntax', () => {
    const src = 'interface U { name: string }\nconst u: U = { name: "x" };\ndb.x.insertOne(u);';
    const p = parseScript(src, 'typescript');
    expect(p.statements).toHaveLength(3);
    expect(p.diagnostics).toHaveLength(0);
  });

  it('reports syntax errors with ranges instead of splitting naively', () => {
    const p = parseScript('const = broken;;;\ndb.x.find()');
    expect(p.diagnostics.length).toBeGreaterThan(0);
    expect(p.diagnostics[0]!.range.startLine).toBe(1);
  });

  it('tracks accurate source ranges', () => {
    const src = 'const a = 1;\n\n\ndb.x.find();';
    const p = parseScript(src);
    expect(p.statements[1]!.range.startLine).toBe(4);
  });

  it('statementAtOffset finds the containing statement', () => {
    const src = 'const a = 1;\ndb.x.find();\nconst b = 2;';
    const p = parseScript(src);
    const insideFind = src.indexOf('find') + 1;
    expect(statementAtOffset(p, insideFind)?.index).toBe(1);
    expect(statementAtOffset(p, 0)?.index).toBe(0);
    expect(statementAtOffset(p, src.length - 1)?.index).toBe(2);
  });

  it('handles chained cursor calls as one statement', () => {
    const p = parseScript('db.x.find({ a: 1 })\n  .sort({ b: -1 })\n  .limit(10);');
    expect(p.statements).toHaveLength(1);
    expect(p.statements[0]!.kind).toBe('expression');
  });
});
