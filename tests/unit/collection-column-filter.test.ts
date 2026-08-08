import { describe, expect, it } from 'vitest';
import { buildColumnFilterExpression, reorderColumns } from '../../src/renderer/collection-column-filter.js';
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

  it('returns an empty filter when every column input is empty', () => {
    expect(buildColumnFilterExpression({ name: ' ', age: '' })).toBe('{}');
  });

  it('reorders a dragged column without losing any column', () => {
    expect(reorderColumns(['_id', 'name', 'quantity'], 'quantity', 'name'))
      .toEqual(['_id', 'quantity', 'name']);
    expect(reorderColumns(['_id', 'name'], 'missing', 'name')).toEqual(['_id', 'name']);
  });
});
