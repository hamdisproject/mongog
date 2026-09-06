import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../../src/renderer/collection-column-filter.js';
import { lengthExpression, parseColumnFilter as parse } from './helpers/column-filter.js';

describe('collection column filters', () => {
  it('uses $size for exact array length', () => {
    expect(parse(buildColumnFilterExpression({ products: 'len = 3' }))).toEqual({
      products: { $size: 3 },
    });
    expect(parse(buildColumnFilterExpression({ products: 'LEN = 0', active: 'true' }))).toEqual({
      products: { $size: 0 },
      active: true,
    });
  });

  it('builds guarded $expr comparisons for array length', () => {
    const greater = parse(buildColumnFilterExpression({ products: 'len > 3' }));
    expect(greater).toEqual(lengthExpression('products', [['$gt', 3]]));

    const notEqual = parse(buildColumnFilterExpression({ products: 'len <> 2' }));
    expect(notEqual).toEqual(lengthExpression('products', [['$ne', 2]]));
    expect(parse(buildColumnFilterExpression({ products: 'len != 2' }))).toEqual(notEqual);
  });

  it('supports inclusive, exclusive, mixed, and reversed-order len ranges', () => {
    expect(parse(buildColumnFilterExpression({ products: 'len 2..5' }))).toEqual(
      lengthExpression('products', [['$gte', 2], ['$lte', 5]]),
    );
    expect(parse(buildColumnFilterExpression({ products: 'len > 2 < 5' }))).toEqual(
      lengthExpression('products', [['$gt', 2], ['$lt', 5]]),
    );
    expect(parse(buildColumnFilterExpression({ products: 'len <= 5 >= 2' }))).toEqual(
      lengthExpression('products', [['$gte', 2], ['$lte', 5]]),
    );
  });

  it('combines len with membership, logical operators, and other columns', () => {
    const source = buildColumnFilterExpression({
      products: 'len >= 2 AND has *Com*',
      active: 'true',
    });
    expect(parse(source)).toEqual({
      $and: [
        {
          $and: [
            lengthExpression('products', [['$gte', 2]]),
            { products: { $in: [{ $regularExpression: { pattern: '.*Com.*', options: 'i' } }] } },
          ],
        },
        { active: true },
      ],
    });

    expect(parse(buildColumnFilterExpression({ products: 'len = 0 OR has *Default*' }))).toEqual({
      $or: [
        { products: { $size: 0 } },
        { products: { $in: [{ $regularExpression: { pattern: '.*Default.*', options: 'i' } }] } },
      ],
    });
  });

  it('rejects invalid len values and ranges by column', () => {
    for (const input of ['len', 'len = -1', 'len = 1.5', 'len 5..2', 'len 2..', 'len > 2 > 5']) {
      const compiled = compileColumnFilters({ products: input });
      expect(compiled.errors.products, input).toBeTruthy();
    }
  });

  it('accepts safe scalar and Compass BSON literals', () => {
    const id = '507f1f77bcf86cd799439011';
    const source = buildColumnFilterExpression({
      active: '= true',
      removedAt: '= null',
      _id: `has ObjectId("${id}")`,
    });
    expect(parse(source)).toEqual({
      active: true,
      removedAt: null,
      _id: { $in: [{ $oid: id }] },
    });
  });

  it('reports invalid ranges and executable values by column', () => {
    const compiled = compileColumnFilters({
      price: '200..100',
      tags: 'has getSecret()',
      valid: '>= 5',
    });
    expect(compiled.errors.price).toMatch(/lower bound/i);
    expect(compiled.errors.tags).toMatch(/does not allow the executable call/i);
    expect(compiled.expression).toContain('"valid": { "$gte": 5 }');
    expect(() => buildColumnFilterExpression({ price: '100..' })).toThrow(/two numeric bounds/i);
    expect(() => buildColumnFilterExpression({ tags: 'has' })).toThrow(/requires a value/i);
  });

  it('keeps a quoted string containing two dots as exact text', () => {
    expect(parse(buildColumnFilterExpression({ version: '"v1..v2"' }))).toEqual({
      version: 'v1..v2',
    });
  });

  it('returns an empty filter when every column input is empty', () => {
    expect(buildColumnFilterExpression({ name: ' ', age: '' })).toBe('{}');
  });

  it('distinguishes quoted empty strings from cleared filters, null, and whitespace', () => {
    expect(parse(buildColumnFilterExpression({ label: '""' }))).toEqual({ label: '' });
    expect(parse(buildColumnFilterExpression({ label: '= ""' }))).toEqual({ label: '' });
    expect(parse(buildColumnFilterExpression({ label: "''" }))).toEqual({ label: '' });
    expect(parse(buildColumnFilterExpression({ label: '"   "' }))).toEqual({ label: '   ' });
    expect(parse(buildColumnFilterExpression({ label: '', other: ' ' }))).toEqual({});
  });
});
