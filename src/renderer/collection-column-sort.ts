import { parseDocumentExpression } from '../features/script-analysis/index.js';

export type ColumnSortDirection = 1 | -1;

export interface ColumnSortIndicator {
  column: string;
  direction: ColumnSortDirection;
  /** MongoDB sort priority, including valid non-direction entries such as $meta. */
  priority: number;
}

export interface ColumnSortCycleResult {
  source: string;
  indicators: ColumnSortIndicator[];
}

export class ColumnSortSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnSortSyntaxError';
  }
}

type SortEntry = [column: string, value: unknown];

/**
 * Append a new ascending field, turn ascending into descending, and remove a
 * descending field. Entry order is retained because it is MongoDB sort priority.
 */
export function cycleColumnSort(source: string, column: string): ColumnSortCycleResult {
  const entries = parseSortEntries(source).map(([field, value]) => (
    [field, normalizeDirection(value) ?? value] as SortEntry
  ));
  const index = entries.findIndex(([field]) => field === column);

  if (index < 0) {
    entries.push([column, 1]);
  } else {
    const current = normalizeDirection(entries[index]![1]);
    if (current === 1) {
      entries[index] = [column, -1];
    } else if (current === -1) {
      entries.splice(index, 1);
    } else {
      // A valid non-direction sort (for example $meta) becomes header-managed.
      entries[index] = [column, 1];
    }
  }

  const nextSource = serializeSortEntries(entries);
  return { source: nextSource, indicators: indicatorsFromEntries(entries) };
}

export function readColumnSortIndicators(source: string): ColumnSortIndicator[] {
  return indicatorsFromEntries(parseSortEntries(source));
}

function parseSortEntries(source: string): SortEntry[] {
  if (!source.trim()) return [];

  let value: unknown;
  try {
    value = JSON.parse(parseDocumentExpression(source, 'Sort').json) as unknown;
  } catch (error) {
    throw new ColumnSortSyntaxError(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(value)) {
    throw new ColumnSortSyntaxError('Sort must be an object literal.');
  }

  const entries = Object.entries(value);
  for (const [field, direction] of entries) {
    if (normalizeDirection(direction) !== null || isMetaSort(direction)) continue;
    throw new ColumnSortSyntaxError(
      `Sort direction for ${JSON.stringify(field)} must be 1, -1, asc, ascending, desc, descending, or a $meta sort.`,
    );
  }
  return entries;
}

function serializeSortEntries(entries: SortEntry[]): string {
  if (entries.length === 0) return '';
  return `{\n${entries.map(([field, value]) => (
    `  ${JSON.stringify(field)}: ${JSON.stringify(value)}`
  )).join(',\n')}\n}`;
}

function indicatorsFromEntries(entries: SortEntry[]): ColumnSortIndicator[] {
  const indicators: ColumnSortIndicator[] = [];
  entries.forEach(([column, value], index) => {
    const direction = normalizeDirection(value);
    if (direction !== null) indicators.push({ column, direction, priority: index + 1 });
  });
  return indicators;
}

function normalizeDirection(value: unknown): ColumnSortDirection | null {
  if (value === 1 || value === -1) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized === 'asc' || normalized === 'ascending') return 1;
  if (normalized === 'desc' || normalized === 'descending') return -1;
  return null;
}

function isMetaSort(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === '$meta' && typeof value.$meta === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
