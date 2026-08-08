import { describe, expect, it } from 'vitest';
import {
  cycleColumnSort,
  readColumnSortIndicators,
} from '../../src/renderer/collection-column-sort.js';

describe('collection column sorting', () => {
  it('cycles ascending, descending, and removed', () => {
    const ascending = cycleColumnSort('', 'price');
    expect(ascending.source).toContain('"price": 1');
    expect(ascending.indicators).toEqual([{ column: 'price', direction: 1, priority: 1 }]);

    const descending = cycleColumnSort(ascending.source, 'price');
    expect(descending.indicators).toEqual([{ column: 'price', direction: -1, priority: 1 }]);

    const removed = cycleColumnSort(descending.source, 'price');
    expect(removed).toEqual({ source: '', indicators: [] });
  });

  it('appends new fields and preserves stable sort priority', () => {
    const price = cycleColumnSort('', 'price');
    const createdAt = cycleColumnSort(price.source, 'createdAt');
    expect(createdAt.indicators).toEqual([
      { column: 'price', direction: 1, priority: 1 },
      { column: 'createdAt', direction: 1, priority: 2 },
    ]);

    const descendingPrice = cycleColumnSort(createdAt.source, 'price');
    expect(descendingPrice.indicators).toEqual([
      { column: 'price', direction: -1, priority: 1 },
      { column: 'createdAt', direction: 1, priority: 2 },
    ]);

    const withoutPrice = cycleColumnSort(descendingPrice.source, 'price');
    expect(withoutPrice.indicators).toEqual([
      { column: 'createdAt', direction: 1, priority: 1 },
    ]);
  });

  it('recognizes aliases, normalizes them, and preserves a valid meta sort', () => {
    expect(readColumnSortIndicators('{ name: "ascending", age: "desc" }')).toEqual([
      { column: 'name', direction: 1, priority: 1 },
      { column: 'age', direction: -1, priority: 2 },
    ]);

    const result = cycleColumnSort('{ score: { $meta: "textScore" }, name: "asc" }', 'age');
    expect(result.source).toContain('"$meta":"textScore"');
    expect(result.source).toContain('"name": 1');
    expect(result.indicators).toEqual([
      { column: 'name', direction: 1, priority: 2 },
      { column: 'age', direction: 1, priority: 3 },
    ]);
  });

  it('replaces a clicked meta sort with ascending direction', () => {
    const result = cycleColumnSort('{ score: { $meta: "textScore" }, name: -1 }', 'score');
    expect(result.source).toContain('"score": 1');
    expect(result.indicators).toEqual([
      { column: 'score', direction: 1, priority: 1 },
      { column: 'name', direction: -1, priority: 2 },
    ]);
  });

  it('rejects invalid syntax and unsupported sort directions', () => {
    expect(() => cycleColumnSort('{ createdAt: }', 'name')).toThrow(/invalid syntax/i);
    expect(() => cycleColumnSort('{ createdAt: 2 }', 'name')).toThrow(/must be 1, -1/i);
  });
});
