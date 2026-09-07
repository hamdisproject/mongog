import type { CatalogOrder } from '../shared/domain/index.js';

const alphabeticalCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

function compareExact(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function orderCatalogEntries<T extends { name: string }>(
  entries: readonly T[],
  order: CatalogOrder,
): T[] {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  if (order === 'alphabetical') {
    indexed.sort((left, right) => (
      alphabeticalCollator.compare(left.entry.name, right.entry.name) ||
      compareExact(left.entry.name, right.entry.name) ||
      left.index - right.index
    ));
  }
  return indexed.map(({ entry }) => entry);
}

export function orderCatalogNames(names: readonly string[], order: CatalogOrder): string[] {
  return orderCatalogEntries(names.map((name) => ({ name })), order).map(({ name }) => name);
}
