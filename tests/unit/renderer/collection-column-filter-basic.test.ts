import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../../src/renderer/collection-column-filter.js';
import { parseDocumentExpression } from '../../../src/features/script-analysis/index.js';
import { lengthExpression, parseColumnFilter as parse } from './helpers/column-filter.js';

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
});
