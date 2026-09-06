import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../../src/renderer/collection-column-filter.js';
import { lengthExpression, parseColumnFilter as parse } from './helpers/column-filter.js';

describe('collection column filters', () => {
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
});
