import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../../src/renderer/collection-column-filter.js';
import { lengthExpression, parseColumnFilter as parse } from './helpers/column-filter.js';

describe('collection column filters', () => {
  it('supports empty strings in nested selectors and scalar-array membership', () => {
    expect(parse(buildColumnFilterExpression({ profile: '{nickname}: ""' }))).toEqual({
      $and: [
        { profile: { $type: 'object' } },
        { 'profile.nickname': '' },
      ],
    });
    expect(parse(buildColumnFilterExpression({ aliases: '[{value}]: ""' }))).toEqual({
      aliases: { $elemMatch: { value: '' } },
    });
    expect(parse(buildColumnFilterExpression({ tags: 'has ""' }))).toEqual({
      tags: { $in: [''] },
    });
  });

  it('compiles object selectors with shape guards and quoted Unicode field names', () => {
    expect(parse(buildColumnFilterExpression({ profile: '{city}: Istanbul' }))).toEqual({
      $and: [
        { profile: { $type: 'object' } },
        { 'profile.city': 'Istanbul' },
      ],
    });
    expect(parse(buildColumnFilterExpression({ profile: '{"şehir"}: Ankara' }))).toEqual({
      $and: [
        { profile: { $type: 'object' } },
        { 'profile.şehir': 'Ankara' },
      ],
    });
  });

  it('uses one $elemMatch for conditions that must match the same array element', () => {
    expect(parse(buildColumnFilterExpression({
      products: '[{name}]: *Com* AND [{price}]: < 200',
    }))).toEqual({
      products: {
        $elemMatch: {
          $and: [
            { name: { $regex: '.*Com.*', $options: 'i' } },
            { price: { $lt: 200 } },
          ],
        },
      },
    });
  });

  it('inherits the last selector and keeps AND precedence inside an array element', () => {
    expect(parse(buildColumnFilterExpression({
      products: '[{price}]: > 100 AND < 200 OR [{name}]: Phone*',
    }))).toEqual({
      products: {
        $elemMatch: {
          $or: [
            {
              $and: [
                { price: { $gt: 100 } },
                { price: { $lt: 200 } },
              ],
            },
            { name: { $regex: '^Phone.*', $options: 'i' } },
          ],
        },
      },
    });
  });

  it('builds repeated nested $elemMatch selectors', () => {
    expect(parse(buildColumnFilterExpression({
      orders: '[{items}][{sku}]: A-42',
    }))).toEqual({
      orders: {
        $elemMatch: {
          items: {
            $elemMatch: { sku: 'A-42' },
          },
        },
      },
    });
    expect(parse(buildColumnFilterExpression({
      container: '{items}[{price}]: 100..200',
    }))).toEqual({
      $and: [
        { container: { $type: 'object' } },
        {
          'container.items': {
            $elemMatch: { price: { $gte: 100, $lte: 200 } },
          },
        },
      ],
    });
  });

  it('supports membership, exact len, BSON literals, and OR on nested leaves', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(parse(buildColumnFilterExpression({
      orders: `[{items}][{tags}]: has *wifi* OR [{items}][{ownerId}]: ObjectId("${id}")`,
    }))).toEqual({
      orders: {
        $elemMatch: {
          items: {
            $elemMatch: {
              $or: [
                { tags: { $in: [{ $regularExpression: { pattern: '.*wifi.*', options: 'i' } }] } },
                { ownerId: { $oid: id } },
              ],
            },
          },
        },
      },
    });
    expect(parse(buildColumnFilterExpression({ orders: '[{items}]: len = 2' }))).toEqual({
      orders: { $elemMatch: { items: { $size: 2 } } },
    });
  });

  it('uses guarded $map/$anyElementTrue expressions for nested len comparisons', () => {
    const generated = buildColumnFilterExpression({
      orders: '[{items}]: len >= 2 AND [{status}]: open',
    });
    const compiled = parse(generated);
    const serialized = JSON.stringify(compiled);
    expect(compiled).toHaveProperty('$expr');
    expect(serialized).toContain('$isArray');
    expect(serialized).toContain('$cond');
    expect(serialized).toContain('$map');
    expect(serialized).toContain('$anyElementTrue');
    expect(serialized).toContain('$size');
    expect(serialized).toContain('nestedItem0');

    const withMembership = parse(buildColumnFilterExpression({
      products: '[{tags}]: len >= 1 AND has *wifi*',
    }));
    const membershipSource = JSON.stringify(withMembership);
    expect(membershipSource).toContain('nestedMember');
    expect(membershipSource).toContain('$regexMatch');
  });

  it('does not treat object literal values as selectors', () => {
    expect(parse(buildColumnFilterExpression({ metadata: '{ code: 1 }' }))).toEqual({
      metadata: { code: 1 },
    });
  });

  it('rejects malformed, unsafe, missing-value, and over-deep selectors', () => {
    const cases = [
      '{}: value',
      '{$secret}: value',
      '{nested.field}: value',
      '{city} value',
      '[{name}]:',
      `${'{next}'.repeat(33)}: value`,
    ];
    for (const source of cases) {
      expect(compileColumnFilters({ profile: source }).errors.profile, source).toBeTruthy();
    }
  });
});
