import { describe, expect, it } from 'vitest';
import { orderCatalogEntries, orderCatalogNames } from '../../../src/renderer/catalog-order.js';

describe('catalog ordering', () => {
  it('sorts case-insensitively with natural numbers and deterministic ties', () => {
    expect(orderCatalogNames(['item10', 'Zoo', 'item2', 'alpha', 'Alpha'], 'alphabetical'))
      .toEqual(['Alpha', 'alpha', 'item2', 'item10', 'Zoo']);
  });

  it('preserves database order and never mutates the source array', () => {
    const source = [{ name: 'zeta', type: 'view' }, { name: 'alpha', type: 'collection' }];

    expect(orderCatalogEntries(source, 'database')).toEqual(source);
    expect(orderCatalogEntries(source, 'database')).not.toBe(source);
    expect(source.map(({ name }) => name)).toEqual(['zeta', 'alpha']);
  });

  it('sorts entries without losing their metadata', () => {
    const source = [{ name: 'zeta', type: 'view' }, { name: 'alpha', type: 'collection' }];

    expect(orderCatalogEntries(source, 'alphabetical')).toEqual([
      { name: 'alpha', type: 'collection' },
      { name: 'zeta', type: 'view' },
    ]);
    expect(source.map(({ name }) => name)).toEqual(['zeta', 'alpha']);
  });
});
