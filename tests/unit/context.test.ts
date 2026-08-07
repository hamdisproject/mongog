import { describe, expect, it } from 'vitest';
import { detectCompletionContext } from '../../src/features/script-analysis/index.js';

/** offset of the marker █ in the fixture */
function at(fixture: string): [source: string, offset: number] {
  const offset = fixture.indexOf('█');
  if (offset < 0) throw new Error('fixture missing marker');
  return [fixture.replace('█', ''), offset];
}

describe('detectCompletionContext', () => {
  it('detects collection-name position in db.collection("...")', () => {
    const [src, off] = at('db.collection("us█")');
    expect(detectCompletionContext(src, off)).toEqual({ kind: 'collection-name' });
  });

  it('detects collection-name position in db.getCollection("...")', () => {
    const [src, off] = at('db.getCollection("█")');
    expect(detectCompletionContext(src, off)).toEqual({ kind: 'collection-name' });
  });

  it('detects database-name position in use("...")', () => {
    const [src, off] = at('use("adm█")');
    expect(detectCompletionContext(src, off)).toEqual({ kind: 'database-name' });
  });

  it('detects database-name position in client.db("...")', () => {
    const [src, off] = at('client.db("█")');
    expect(detectCompletionContext(src, off)).toEqual({ kind: 'database-name' });
  });

  it('detects filter field position with collection context', () => {
    const [src, off] = at('db.collection("orders").find({ ac█: true })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('document-key');
    if (ctx.kind === 'document-key') {
      expect(ctx.docKind).toBe('filter');
      expect(ctx.collection).toBe('orders');
      expect(ctx.method).toBe('find');
    }
  });

  it('detects nested filter value position as filter context', () => {
    const [src, off] = at('db.collection("users").find({ address: { ci█: "x" } })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('document-key');
    if (ctx.kind === 'document-key') {
      expect(ctx.docKind).toBe('filter');
      expect(ctx.pathPrefix).toBe('address');
    }
  });

  it('detects operator position ($-prefixed key)', () => {
    const [src, off] = at('db.collection("users").find({ age: { $g█: 5 } })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('operator');
    if (ctx.kind === 'operator') {
      expect(ctx.docKind).toBe('filter');
      expect(ctx.operatorScope).toBe('field');
    }
  });

  it('detects update document context (arg 1 of updateMany)', () => {
    const [src, off] = at('db.collection("users").updateMany({ a: 1 }, { $s█: { b: 2 } })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('operator');
    if (ctx.kind === 'operator') {
      expect(ctx.docKind).toBe('update');
      expect(ctx.collection).toBe('users');
      expect(ctx.operatorScope).toBe('update');
    }
  });

  it('detects aggregation stage position', () => {
    const [src, off] = at('db.collection("orders").aggregate([{ $ma█: {} }])');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('aggregation-stage');
    if (ctx.kind === 'aggregation-stage') expect(ctx.collection).toBe('orders');
  });

  it('detects stage position in later pipeline stages', () => {
    const [src, off] = at('db.collection("o").aggregate([{ $match: {} }, { $gr█: {} }])');
    expect(detectCompletionContext(src, off).kind).toBe('aggregation-stage');
  });

  it('refines field context inside schema-aware pipeline stages', () => {
    const [src, off] = at('db.collection("orders").aggregate([{ $match: { sta█: "paid" } }])');
    expect(detectCompletionContext(src, off)).toMatchObject({
      kind: 'document-key',
      docKind: 'filter',
      collection: 'orders',
    });
  });

  it('detects aggregation field references', () => {
    const [src, off] = at('db.collection("orders").aggregate([{ $group: { _id: "$sta█" } }])');
    expect(detectCompletionContext(src, off)).toEqual({
      kind: 'field-reference',
      collection: 'orders',
    });
  });

  it('detects sort context in .sort({...})', () => {
    const [src, off] = at('db.collection("u").find({}).sort({ cr█: -1 })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('document-key');
    if (ctx.kind === 'document-key') expect(ctx.docKind).toBe('sort');
  });

  it('detects projection context in find options', () => {
    const [src, off] = at('db.collection("u").find({}, { projection: { na█: 1 } })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('document-key');
    if (ctx.kind === 'document-key') expect(ctx.docKind).toBe('projection');
  });

  it('detects insert document context', () => {
    const [src, off] = at('db.collection("u").insertOne({ na█: "x" })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx.kind).toBe('document-key');
    if (ctx.kind === 'document-key') expect(ctx.docKind).toBe('document');
  });

  it('defers plain identifiers to the TS service', () => {
    const [src, off] = at('const x = db.collection("u"); x.fi█');
    expect(detectCompletionContext(src, off).kind).toBe('identifier');
  });

  it('defers string values (non-key positions) to the TS service', () => {
    const [src, off] = at('db.collection("u").find({ name: "ad█" })');
    expect(detectCompletionContext(src, off).kind).toBe('identifier');
  });

  it('resolves a collection through a local collection variable', () => {
    const [src, off] = at(`const users = db.collection("users");
users.find({ na█: "Ada" });`);
    const ctx = detectCompletionContext(src, off);
    expect(ctx).toMatchObject({
      kind: 'document-key',
      docKind: 'filter',
      collection: 'users',
      method: 'find',
    });
  });

  it('resolves a collection through a cursor variable and chained method', () => {
    const [src, off] = at(`const users = db.collection("users");
const cursor = users.find({});
cursor.sort({ na█: 1 });`);
    const ctx = detectCompletionContext(src, off);
    expect(ctx).toMatchObject({
      kind: 'document-key',
      docKind: 'sort',
      collection: 'users',
      method: 'sort',
    });
  });

  it('classifies logical operators at the filter root', () => {
    const [src, off] = at('db.collection("users").find({ $a█: [] })');
    const ctx = detectCompletionContext(src, off);
    expect(ctx).toMatchObject({
      kind: 'operator',
      docKind: 'filter',
      operatorScope: 'root',
    });
  });
});
