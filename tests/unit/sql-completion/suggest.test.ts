import { describe, expect, it } from 'vitest';
import type { SchemaFieldInfo } from '../../../src/shared/domain/index.js';
import {
  buildSqlSuggestions,
  collectionNameSuggestions,
  normalizeSampledPath,
  type SqlSchemaInput,
} from '../../../src/features/sql-completion/index.js';
import { translateSql } from '../../../src/features/sql-translator/index.js';

function field(path: string, bsonType = 'string', presence = 1): SchemaFieldInfo {
  return { path, types: [{ bsonType, proportion: 1 }], presence };
}

const ordersSchema: SqlSchemaInput = {
  table: 'orders',
  alias: 'o',
  db: null,
  fields: [
    field('_id', 'objectId'),
    field('status'),
    field('total', 'int32', 0.9),
    field('address.city'),
    field('address.zip'),
    field('items[].sku'),
    field('my col'),
  ],
};

describe('buildSqlSuggestions field context', () => {
  it('suggests full dotted paths, aliases, keywords and functions', () => {
    const suggestions = buildSqlSuggestions(
      { kind: 'field', tables: [{ table: 'orders', alias: 'o', db: null }], qualifierChain: [] },
      { collectionNames: ['orders'], databaseNames: ['shop'], schemas: [ordersSchema] },
    );
    const byLabel = new Map(suggestions.map((suggestion) => [suggestion.label, suggestion]));
    expect(byLabel.get('address.city')).toMatchObject({ kind: 'field' });
    expect(byLabel.get('items.sku')).toMatchObject({ kind: 'field' });
    expect(byLabel.has('items[].sku')).toBe(false);
    expect(byLabel.get('my col')).toMatchObject({ kind: 'field', insertText: '`my col`' });
    expect(byLabel.get('o')).toMatchObject({ kind: 'alias' });
    expect(byLabel.get('SELECT')).toMatchObject({ kind: 'keyword' });
    expect(byLabel.get('COUNT')).toMatchObject({ kind: 'function', snippet: true });
    expect(byLabel.get('UPPER')).toMatchObject({ kind: 'function' });
  });

  it('dedupes shared paths across tables and merges alias details', () => {
    const suggestions = buildSqlSuggestions(
      {
        kind: 'field',
        tables: [
          { table: 'orders', alias: 'o', db: null },
          { table: 'users', alias: 'u', db: null },
        ],
        qualifierChain: [],
      },
      {
        collectionNames: [],
        databaseNames: [],
        schemas: [ordersSchema, { table: 'users', alias: 'u', db: null, fields: [field('status')] }],
      },
    );
    const status = suggestions.filter((suggestion) => suggestion.label === 'status');
    expect(status).toHaveLength(1);
    expect(status[0]!.detail).toContain('o, u');
  });
});

describe('buildSqlSuggestions qualified context', () => {
  it('completes top-level fields after an alias dot', () => {
    const labels = buildSqlSuggestions(
      { kind: 'qualified', tables: [{ table: 'orders', alias: 'o', db: null }], qualifierChain: ['o'] },
      { collectionNames: [], databaseNames: [], schemas: [ordersSchema] },
    ).map((suggestion) => suggestion.label);
    expect(labels).toContain('status');
    expect(labels).toContain('address');
    expect(labels).toContain('total');
  });

  it('drills into nested documents level by level', () => {
    const first = buildSqlSuggestions(
      { kind: 'qualified', tables: [{ table: 'orders', alias: 'o', db: null }], qualifierChain: ['o', 'address'] },
      { collectionNames: [], databaseNames: [], schemas: [ordersSchema] },
    ).map((suggestion) => suggestion.label);
    expect(first).toEqual(expect.arrayContaining(['city', 'zip']));
    expect(first).not.toContain('status');

    const bare = buildSqlSuggestions(
      { kind: 'qualified', tables: [{ table: 'orders', alias: 'o', db: null }], qualifierChain: ['address'] },
      { collectionNames: [], databaseNames: [], schemas: [ordersSchema] },
    ).map((suggestion) => suggestion.label);
    expect(bare).toEqual(expect.arrayContaining(['city', 'zip']));
  });

  it('walks into arrays via normalized element paths', () => {
    const labels = buildSqlSuggestions(
      { kind: 'qualified', tables: [{ table: 'orders', alias: 'o', db: null }], qualifierChain: ['o', 'items'] },
      { collectionNames: [], databaseNames: [], schemas: [ordersSchema] },
    ).map((suggestion) => suggestion.label);
    expect(labels).toContain('sku');
  });
});

describe('buildSqlSuggestions table context', () => {
  it('suggests collections, databases and follow-up clauses', () => {
    const suggestions = buildSqlSuggestions(
      { kind: 'table', tables: [], qualifierChain: [] },
      { collectionNames: ['orders'], databaseNames: ['shop'], schemas: [] },
    );
    const byLabel = new Map(suggestions.map((suggestion) => [suggestion.label, suggestion]));
    expect(byLabel.get('orders')).toMatchObject({ kind: 'table' });
    expect(byLabel.get('shop')).toMatchObject({ kind: 'database' });
    expect(byLabel.get('WHERE')).toMatchObject({ kind: 'keyword' });
    expect(collectionNameSuggestions(['my table'])[0]).toMatchObject({
      label: 'my table',
      insertText: '"my table"',
    });
  });
});

describe('suggested inserts round-trip through the translator', () => {
  it('accepts backticked paths with spaces in filters', () => {
    expect(normalizeSampledPath('items[].sku')).toBe('items.sku');
    const translation = translateSql('SELECT `my col`, `address.city` FROM t WHERE `my col` = 1');
    expect(translation.filter).toEqual({ 'my col': 1 });
    expect(translation.projection).toEqual({ 'my col': 1, 'address.city': 1, _id: 0 });
  });
});
