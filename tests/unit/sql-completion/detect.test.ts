import { describe, expect, it } from 'vitest';
import {
  detectSqlCompletionContext,
  quoteSqlIdentifier,
  quoteSqlPath,
} from '../../../src/features/sql-completion/index.js';

function atEnd(text: string) {
  return detectSqlCompletionContext(text, text.length);
}

describe('detectSqlCompletionContext', () => {
  it('starts empty editors with keywords', () => {
    expect(atEnd('')).toMatchObject({ kind: 'keyword', tables: [] });
    expect(atEnd('   ')).toMatchObject({ kind: 'keyword' });
  });

  it('detects field positions in the select list and filters', () => {
    expect(atEnd('SELECT ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT a, ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT * FROM orders WHERE ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT * FROM orders WHERE total > 1 AND ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT status FROM orders GROUP BY ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT status FROM orders ORDER BY ')).toMatchObject({ kind: 'field' });
    expect(atEnd('SELECT COUNT(')).toMatchObject({ kind: 'field' });
  });

  it('detects table positions after FROM/JOIN/UPDATE/INTO', () => {
    expect(atEnd('SELECT * FROM ')).toMatchObject({ kind: 'table' });
    expect(atEnd('SELECT * FROM orders INNER JOIN ')).toMatchObject({ kind: 'table' });
    expect(atEnd('UPDATE ')).toMatchObject({ kind: 'table' });
    expect(atEnd('INSERT INTO ')).toMatchObject({ kind: 'table' });
    expect(atEnd('DELETE FROM ')).toMatchObject({ kind: 'table' });
  });

  it('extracts aliases and database qualifiers into scope', () => {
    const ctx = atEnd('SELECT o.total FROM shop.orders o INNER JOIN users AS u ON o.id = u.id WHERE ');
    expect(ctx.kind).toBe('field');
    expect(ctx.tables).toEqual([
      { table: 'orders', alias: 'o', db: 'shop' },
      { table: 'users', alias: 'u', db: null },
    ]);
  });

  it('supports comma-separated FROM entries', () => {
    const ctx = atEnd('SELECT * FROM a, b WHERE ');
    expect(ctx.tables.map((table) => table.table)).toEqual(['a', 'b']);
  });

  it('detects dotted qualifier chains', () => {
    expect(atEnd('SELECT o.')).toMatchObject({ kind: 'qualified', qualifierChain: ['o'] });
    expect(atEnd('SELECT o.address.')).toMatchObject({
      kind: 'qualified',
      qualifierChain: ['o', 'address'],
    });
    expect(atEnd('SELECT * FROM t WHERE address.')).toMatchObject({
      kind: 'qualified',
      qualifierChain: ['address'],
    });
    expect(atEnd('SELECT * FROM shop.')).toMatchObject({
      kind: 'qualified',
      qualifierChain: ['shop'],
    });
  });

  it('keeps string literals and comments out of scope detection', () => {
    const ctx = atEnd(`SELECT * FROM t WHERE note = 'FROM fake JOIN bogus' AND `);
    expect(ctx.kind).toBe('field');
    expect(ctx.tables).toEqual([{ table: 't', alias: 't', db: null }]);
    const commented = atEnd('-- SELECT * FROM ghost\nSELECT * FROM real WHERE ');
    expect(commented.tables).toEqual([{ table: 'real', alias: 'real', db: null }]);
  });

  it('isolates the statement under the cursor', () => {
    const text = 'SELECT * FROM a; SELECT * FROM b WHERE ';
    expect(detectSqlCompletionContext(text, text.length).tables)
      .toEqual([{ table: 'b', alias: 'b', db: null }]);
  });

  it('treats value positions as keywords, not fields', () => {
    expect(atEnd('SELECT * FROM t LIMIT ')).toMatchObject({ kind: 'keyword' });
    expect(atEnd('SELECT a AS ')).toMatchObject({ kind: 'keyword' });
  });
});

describe('quoteSqlIdentifier', () => {
  it('leaves bare identifiers alone and backticks the rest', () => {
    expect(quoteSqlIdentifier('total')).toBe('total');
    expect(quoteSqlIdentifier('_id')).toBe('_id');
    expect(quoteSqlIdentifier('my col')).toBe('`my col`');
    expect(quoteSqlIdentifier('2fast')).toBe('`2fast`');
    expect(quoteSqlIdentifier('select')).toBe('`select`');
    expect(quoteSqlPath('my col.x')).toBe('`my col.x`');
    expect(quoteSqlPath('total')).toBe('total');
  });
});
