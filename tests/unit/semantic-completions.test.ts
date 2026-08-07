import { describe, expect, it } from 'vitest';
import {
  buildSemanticSuggestions,
  contextNeedsSchema,
  detectCompletionContext,
} from '../../src/features/script-analysis/index.js';
import type { SchemaFieldInfo } from '../../src/shared/domain/index.js';

const fields: SchemaFieldInfo[] = [
  { path: '_id', types: [{ bsonType: 'objectid', proportion: 1 }], presence: 1 },
  { path: 'name', types: [{ bsonType: 'string', proportion: 1 }], presence: 1, exampleEjson: '"Ada"' },
  { path: 'address', types: [{ bsonType: 'object', proportion: 1 }], presence: 0.9 },
  { path: 'address.city', types: [{ bsonType: 'string', proportion: 1 }], presence: 0.9 },
  { path: 'address.geo', types: [{ bsonType: 'object', proportion: 1 }], presence: 0.5 },
  { path: 'address.geo.lat', types: [{ bsonType: 'double', proportion: 1 }], presence: 0.5 },
];

function contextAt(fixture: string) {
  const offset = fixture.indexOf('█');
  if (offset < 0) throw new Error('fixture missing marker');
  return detectCompletionContext(fixture.replace('█', ''), offset);
}

describe('semantic completion suggestions', () => {
  it('sorts and de-duplicates live database and collection names', () => {
    expect(buildSemanticSuggestions(
      { kind: 'database-name' },
      { databaseNames: ['zeta', 'admin', 'admin'] },
    ).map((item) => item.label)).toEqual(['admin', 'zeta']);
    expect(buildSemanticSuggestions(
      { kind: 'collection-name' },
      { collectionNames: ['users', 'orders'] },
    ).map((item) => item.label)).toEqual(['orders', 'users']);
  });

  it('offers inferred fields at root document-key positions', () => {
    const context = contextAt('db.collection("users").find({ na█: 1 })');
    expect(contextNeedsSchema(context)).toBe(true);
    const suggestions = buildSemanticSuggestions(context, { fields });
    expect(suggestions.map((item) => item.label)).toContain('name');
    expect(suggestions.map((item) => item.label)).toContain('address.city');
    expect(suggestions.find((item) => item.label === 'name')).toMatchObject({
      kind: 'field',
      detail: 'string · 100% sampled',
    });
  });

  it('offers relative immediate fields inside nested documents', () => {
    const context = contextAt('db.collection("users").find({ address: { ci█: 1 } })');
    expect(context).toMatchObject({ kind: 'document-key', pathPrefix: 'address' });
    expect(buildSemanticSuggestions(context, { fields }).map((item) => item.label))
      .toEqual(['city', 'geo']);
  });

  it('separates root, field, and update operators', () => {
    const root = contextAt('db.collection("users").find({ $a█: [] })');
    const field = contextAt('db.collection("users").find({ age: { $g█: 18 } })');
    const update = contextAt('db.collection("users").updateOne({}, { $s█: {} })');
    expect(buildSemanticSuggestions(root, {}).map((item) => item.label)).toContain('$and');
    expect(buildSemanticSuggestions(root, {}).map((item) => item.label)).not.toContain('$gt');
    expect(buildSemanticSuggestions(field, {}).map((item) => item.label)).toContain('$gt');
    expect(buildSemanticSuggestions(field, {}).map((item) => item.label)).not.toContain('$set');
    expect(buildSemanticSuggestions(update, {}).map((item) => item.label)).toContain('$set');
  });

  it('offers aggregation stages only at direct pipeline stage positions', () => {
    const context = contextAt('db.collection("orders").aggregate([{ $ma█: {} }])');
    const suggestions = buildSemanticSuggestions(context, {});
    expect(suggestions.map((item) => item.label)).toContain('$match');
    expect(suggestions.map((item) => item.label)).toContain('$group');
    expect(suggestions.every((item) => item.kind === 'stage')).toBe(true);
  });

  it('offers schema fields inside $match and aggregation field references', () => {
    const matchContext = contextAt('db.collection("users").aggregate([{ $match: { na█: "Ada" } }])');
    expect(buildSemanticSuggestions(matchContext, { fields }).map((item) => item.label))
      .toContain('name');

    const referenceContext = contextAt('db.collection("users").aggregate([{ $group: { _id: "$na█" } }])');
    expect(contextNeedsSchema(referenceContext)).toBe(true);
    expect(buildSemanticSuggestions(referenceContext, { fields }).find((item) => item.label === '$name'))
      .toMatchObject({ insertText: 'name', kind: 'field-reference' });
  });

  it('leaves ordinary identifiers to Monaco TypeScript completions', () => {
    expect(buildSemanticSuggestions(
      contextAt('const users = db.collection("users"); users.fi█'),
      { fields },
    )).toEqual([]);
  });
});
