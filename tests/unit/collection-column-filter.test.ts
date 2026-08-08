import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../src/renderer/collection-column-filter.js';
import { parseDocumentExpression } from '../../src/features/script-analysis/index.js';

describe('collection column filters', () => {
  it('builds exact, wildcard, comparison, and existence filters', () => {
    const source = buildColumnFilterExpression({
      name: '*bike*',
      quantity: '>= 10',
      active: 'true',
      optional: '*',
    });
    const parsed = JSON.parse(parseDocumentExpression(source, 'Filter').json) as Record<string, unknown>;
    expect(parsed).toEqual({
      name: { $regex: '.*bike.*', $options: 'i' },
      quantity: { $gte: 10 },
      active: true,
      optional: { $exists: true },
    });
  });

  it('quotes field names and treats plain text as an exact string', () => {
    const source = buildColumnFilterExpression({ 'display name': 'Road Bike', score: '<5' });
    expect(JSON.parse(parseDocumentExpression(source, 'Filter').json)).toEqual({
      'display name': 'Road Bike',
      score: { $lt: 5 },
    });
  });

  it('supports both not-equal aliases', () => {
    const angle = parse(buildColumnFilterExpression({ quantity: '<> 10' }));
    const bang = parse(buildColumnFilterExpression({ quantity: '!= 10' }));
    expect(angle).toEqual({ quantity: { $ne: 10 } });
    expect(bang).toEqual(angle);
  });

  it('builds inclusive, exclusive, mixed, and reversed-order numeric ranges', () => {
    expect(parse(buildColumnFilterExpression({ price: '100..200' }))).toEqual({
      price: { $gte: 100, $lte: 200 },
    });
    expect(parse(buildColumnFilterExpression({ price: '> 100 < 200' }))).toEqual({
      price: { $gt: 100, $lt: 200 },
    });
    expect(parse(buildColumnFilterExpression({ price: '>= 100 < 200' }))).toEqual({
      price: { $gte: 100, $lt: 200 },
    });
    expect(parse(buildColumnFilterExpression({ price: '<= 200 > 100' }))).toEqual({
      price: { $gt: 100, $lte: 200 },
    });
  });

  it('maps array membership to $in and $nin', () => {
    const source = buildColumnFilterExpression({
      amenities: 'has "wifi"',
      excludedTags: '!has blocked',
    });
    expect(parse(source)).toEqual({
      amenities: { $in: ['wifi'] },
      excludedTags: { $nin: ['blocked'] },
    });
  });

  it('turns has and !has wildcards into case-insensitive BSON regular expressions', () => {
    const source = buildColumnFilterExpression({
      products: 'has "*Com*"',
      excludedProducts: '!has Com*',
    });
    expect(parse(source)).toEqual({
      products: {
        $in: [{ $regularExpression: { pattern: '.*Com.*', options: 'i' } }],
      },
      excludedProducts: {
        $nin: [{ $regularExpression: { pattern: '^Com.*', options: 'i' } }],
      },
    });
  });

  it('combines complete column-filter terms with OR and AND', () => {
    const either = parse(buildColumnFilterExpression({
      products: 'has *Com* OR has *Phone*',
    }));
    expect(either).toEqual({
      $or: [
        { products: { $in: [{ $regularExpression: { pattern: '.*Com.*', options: 'i' } }] } },
        { products: { $in: [{ $regularExpression: { pattern: '.*Phone.*', options: 'i' } }] } },
      ],
    });

    const both = parse(buildColumnFilterExpression({
      products: 'has *Com* AND !has *Used*',
    }));
    expect(both).toEqual({
      $and: [
        { products: { $in: [{ $regularExpression: { pattern: '.*Com.*', options: 'i' } }] } },
        { products: { $nin: [{ $regularExpression: { pattern: '.*Used.*', options: 'i' } }] } },
      ],
    });
  });

  it('gives AND precedence over OR and combines logical fields with other columns', () => {
    const source = buildColumnFilterExpression({
      products: 'has *Computer* OR has *Phone* AND !has *Used*',
      active: 'true',
    });
    expect(parse(source)).toEqual({
      $and: [
        {
          $or: [
            { products: { $in: [{ $regularExpression: { pattern: '.*Computer.*', options: 'i' } }] } },
            {
              $and: [
                { products: { $in: [{ $regularExpression: { pattern: '.*Phone.*', options: 'i' } }] } },
                { products: { $nin: [{ $regularExpression: { pattern: '.*Used.*', options: 'i' } }] } },
              ],
            },
          ],
        },
        { active: true },
      ],
    });
  });

  it('does not split logical words inside quoted strings or regex literals', () => {
    expect(parse(buildColumnFilterExpression({ label: '"Research and Development"' }))).toEqual({
      label: 'Research and Development',
    });
    const regex = parse(buildColumnFilterExpression({ products: 'has /Com or Phone/i' }));
    expect(regex).toEqual({
      products: { $in: [{ $regularExpression: { pattern: 'Com or Phone', options: 'i' } }] },
    });
  });

  it('rejects incomplete logical expressions', () => {
    const compiled = compileColumnFilters({ products: 'has *Com* OR' });
    expect(compiled.errors.products).toMatch(/OR requires a filter on both sides/i);
  });

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

  it('reorders a dragged column without losing any column', () => {
    expect(reorderColumns(['_id', 'name', 'quantity'], 'quantity', 'name'))
      .toEqual(['_id', 'quantity', 'name']);
    expect(reorderColumns(['_id', 'name'], 'missing', 'name')).toEqual(['_id', 'name']);
  });
});

function parse(source: string): Record<string, unknown> {
  return JSON.parse(parseDocumentExpression(source, 'Filter').json) as Record<string, unknown>;
}

function lengthExpression(
  field: string,
  comparisons: Array<[operator: string, value: number]>,
): Record<string, unknown> {
  const isArray = { $isArray: `$${field}` };
  const safeSize = { $size: { $cond: [isArray, `$${field}`, []] } };
  return {
    $expr: {
      $and: [
        isArray,
        ...comparisons.map(([operator, value]) => ({ [operator]: [safeSize, value] })),
      ],
    },
  };
}
