import type { DocumentCriteriaState, DocumentCriteriaText } from '../shared/domain/index.js';

export type CollectionViewMode = 'documents' | 'query';

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
