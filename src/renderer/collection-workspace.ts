import type {
  DocumentCriteriaState,
  DocumentCriteriaText,
  TableColumnOrder,
} from '../shared/domain/index.js';

export type CollectionViewMode = 'documents' | 'query';

export const COLLECTION_PAGE_SIZE_PRESETS = [10, 25, 50, 100, 250, 500] as const;

export interface CollectionPageSizeOption {
  value: 'default' | `${number}`;
  pageSize: number;
  label: string;
}

export const EMPTY_DOCUMENT_CRITERIA: DocumentCriteriaText = {
  filter: '{}',
  sort: '',
  projection: '',
};

export function emptyDocumentCriteriaState(): DocumentCriteriaState {
  return {
    draft: { ...EMPTY_DOCUMENT_CRITERIA },
    applied: { ...EMPTY_DOCUMENT_CRITERIA },
  };
}

export function collectionQueryTemplate(collection: string, pageSize = 50): string {
  return `db.collection(${JSON.stringify(collection)}).find({}).limit(${pageSize});\n`;
}

/** Build tab-local Documents page-size choices without duplicating the global default. */
export function collectionPageSizeOptions(defaultPageSize: number): CollectionPageSizeOption[] {
  return [
    { value: 'default', pageSize: defaultPageSize, label: `Default · ${defaultPageSize}` },
    ...COLLECTION_PAGE_SIZE_PRESETS
      .filter((pageSize) => pageSize !== defaultPageSize)
      .map((pageSize) => ({
        value: String(pageSize) as `${number}`,
        pageSize,
        label: String(pageSize),
      })),
  ];
}

/** Keep the last useful Documents schema when a filter returns no rows. */
export function reconcileCollectionColumns(
  previous: string[],
  discovered: string[],
  manuallyReordered = false,
): string[] {
  if (discovered.length === 0) return previous;
  if (!manuallyReordered) return arraysEqual(previous, discovered) ? previous : discovered;
  const retained = previous.filter((column) => discovered.includes(column));
  const next = [...retained, ...discovered.filter((column) => !retained.includes(column))];
  return arraysEqual(previous, next) ? previous : next;
}

/** Discover top-level table columns while keeping required UI columns visible. */
export function extractCollectionColumns(
  documents: Array<Record<string, unknown>>,
  columnOrder: TableColumnOrder = 'alphabetical',
  requiredColumns: string[] = [],
): string[] {
  if (documents.length === 0 && requiredColumns.length === 0) return [];
  const keys = new Set<string>();
  for (const document of documents) {
    for (const key of Object.keys(document)) keys.add(key);
  }
  for (const column of requiredColumns) keys.add(column);
  const fields = Array.from(keys).filter((key) => key !== '_id');
  if (columnOrder === 'alphabetical') fields.sort();
  return ['_id', ...fields];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Rename only an untouched generated collection query while retaining its original limit. */
export function renameCollectionQueryTemplate(
  source: string | undefined,
  oldCollection: string,
  newCollection: string,
): string | undefined {
  if (source === undefined) return undefined;
  const prefix = `db.collection(${JSON.stringify(oldCollection)}).find({}).limit(`;
  if (!source.startsWith(prefix) || !source.endsWith(');\n')) return source;
  const limitSource = source.slice(prefix.length, -3);
  if (!/^\d+$/.test(limitSource)) return source;
  const pageSize = Number(limitSource);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) return source;
  return collectionQueryTemplate(newCollection, pageSize);
}

export function collectionDocumentsOwnerId(tabId: string): string {
  return `${tabId}:documents`;
}
