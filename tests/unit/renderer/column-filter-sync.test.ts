import { describe, expect, it } from 'vitest';
import { parseDocumentExpression } from '../../../src/features/script-analysis/index.js';
import { compileColumnFilters, type ColumnFilterMap } from '../../../src/renderer/collection-column-filter.js';
import {
  deriveColumnFilters,
  rebuildFilterFromColumns,
  type OwnedColumnClauses,
} from '../../../src/renderer/column-filter-sync.js';

const MANUAL_OR = '$or: [{ a: 1 }, { b: 2 }]';

function parse(source: string): unknown {
  return JSON.parse(parseDocumentExpression(source, 'Filter').json);
}

function rebuild(filter: string, owned: OwnedColumnClauses, columns: ColumnFilterMap) {
  const result = rebuildFilterFromColumns(filter, owned, columns);
  if (result.kind !== 'ok') throw new Error(`Expected ok, got ${JSON.stringify(result)}`);
  return result;
}

describe('column filter sync: Filter → columns', () => {
  it('maps simple manual conditions back to readable column syntax', () => {
    const derived = deriveColumnFilters(`{
      name: "Ada",
      quantity: { $gt: 4 },
      price: { $gte: 1, $lte: 9 },
      status: { $ne: "archived" },
      title: { $regex: ".*bike.*", $options: "i" },
      optional: { $exists: true },
      sizes: { $size: 3 },
      tags: { $in: ["x"] },
      active: true,
      empty: "",
    }`);
    expect(derived?.columns).toEqual({
      name: 'Ada',
      quantity: '> 4',
      price: '1..9',
      status: '<> archived',
      title: '*bike*',
      optional: '*',
      sizes: 'len = 3',
      tags: 'has x',
      active: 'true',
      empty: '""',
    });
  });

  it('keeps BSON constructors and operator objects verbatim when no shorthand exists', () => {
    const derived = deriveColumnFilters(
      '{ _id: ObjectId("507f1f77bcf86cd799439011"), quantity: { $in: [1, 2] } }',
    );
    expect(derived?.columns).toEqual({
      _id: 'ObjectId("507f1f77bcf86cd799439011")',
      quantity: '{ $in: [1, 2] }',
    });
  });

  it('leaves dotted paths, cross-field $or and $expr in the Filter only', () => {
    const derived = deriveColumnFilters(
      `{ "catalog.city": "", ${MANUAL_OR}, $expr: { $gt: ["$a", 1] }, name: "Ada" }`,
    );
    expect(derived?.columns).toEqual({ name: 'Ada' });
    expect(Object.keys(derived?.owned ?? {})).toEqual(['name']);
  });

  it('returns null while the Filter text is invalid', () => {
    expect(deriveColumnFilters('{ name: ')).toBeNull();
  });

  it('treats an empty Filter as no column filters', () => {
    expect(deriveColumnFilters('')).toEqual({ columns: {}, owned: {} });
    expect(deriveColumnFilters('{}')).toEqual({ columns: {}, owned: {} });
  });
});

describe('column filter sync: columns → Filter', () => {
  it('matches the existing column-only output format', () => {
    for (const columns of [{ name: 'Ada', quantity: '> 4' }, { name: 'Ada OR Grace', quantity: '> 4' }]) {
      expect(rebuild('{}', {}, columns).filter).toBe(compileColumnFilters(columns).expression);
    }
  });

  it('keeps manual conditions verbatim while adding column conditions', () => {
    const result = rebuild(`{ ${MANUAL_OR}, "catalog.city": "Austin" }`, {}, { name: 'Ada' });
    expect(result.filter).toContain(MANUAL_OR);
    expect(result.filter).toContain('"catalog.city": "Austin"');
    expect(parse(result.filter)).toEqual({
      $or: [{ a: 1 }, { b: 2 }],
      'catalog.city': 'Austin',
      name: 'Ada',
    });
  });

  it('lets a column edit replace a condition that was typed in the Filter', () => {
    const filter = `{ name: "Ada", ${MANUAL_OR} }`;
    const derived = deriveColumnFilters(filter)!;
    const result = rebuild(filter, derived.owned, { ...derived.columns, name: 'Grace' });
    expect(parse(result.filter)).toEqual({ $or: [{ a: 1 }, { b: 2 }], name: 'Grace' });
  });

  it('replaces a column\'s previous logical clause instead of duplicating it', () => {
    let filter = `{ ${MANUAL_OR} }`;
    let owned: OwnedColumnClauses = {};
    for (const text of ['Ada OR Grace', '{city}: Austin', 'len > 3', 'Linus']) {
      ({ filter, owned } = rebuild(filter, owned, { name: text }));
    }
    expect(parse(filter)).toEqual({ $or: [{ a: 1 }, { b: 2 }], name: 'Linus' });
  });

  it('switches to $and when a column condition shares a field with a manual one', () => {
    const filter = '{ $and: [{ quantity: { $gt: 1 } }, { quantity: { $lt: 9 } }] }';
    const derived = deriveColumnFilters(filter)!;
    expect(derived.columns).toEqual({ quantity: '> 1' });
    const result = rebuild(filter, derived.owned, { quantity: '>= 2' });
    expect(parse(result.filter)).toEqual({
      $and: [{ quantity: { $lt: 9 } }, { quantity: { $gte: 2 } }],
    });
  });

  it('produces {} when every condition is removed', () => {
    const derived = deriveColumnFilters('{ name: "Ada" }')!;
    expect(rebuildFilterFromColumns('{ name: "Ada" }', derived.owned, {}))
      .toEqual({ kind: 'ok', filter: '{}', owned: {} });
  });

  it('reports column syntax errors without producing a Filter', () => {
    expect(rebuildFilterFromColumns('{}', {}, { price: '100..' })).toMatchObject({
      kind: 'column-errors',
      errors: { price: expect.any(String) },
    });
  });

  it('refuses to overwrite an invalid Filter', () => {
    expect(rebuildFilterFromColumns('{ name: ', {}, { quantity: '> 4' })).toMatchObject({
      kind: 'invalid-filter',
    });
  });

  it('round-trips simple column inputs through the Filter', () => {
    const columns = { name: 'Ada', quantity: '> 4', price: '1..9', title: '*bike*', status: '<> archived' };
    expect(deriveColumnFilters(rebuild('{}', {}, columns).filter)?.columns).toEqual(columns);
  });
});
