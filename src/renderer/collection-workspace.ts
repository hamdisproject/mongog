import type { DocumentCriteriaState, DocumentCriteriaText } from '../shared/domain/index.js';

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
export function reconcileCollectionColumns(previous: string[], discovered: string[]): string[] {
  if (discovered.length === 0) return previous;
  const retained = previous.filter((column) => discovered.includes(column));
  const next = [...retained, ...discovered.filter((column) => !retained.includes(column))];
  return next.length === previous.length && next.every((column, index) => column === previous[index])
    ? previous
    : next;
}

/** Discover top-level table columns; no documents means no new schema was observed. */
export function extractCollectionColumns(documents: Array<Record<string, unknown>>): string[] {
  if (documents.length === 0) return [];
  const keys = new Set<string>();
  for (const document of documents) {
    for (const key of Object.keys(document)) keys.add(key);
  }
  return ['_id', ...Array.from(keys).filter((key) => key !== '_id').sort()];
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
