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

export function collectionQueryTemplate(collection: string): string {
  return `db.collection(${JSON.stringify(collection)}).find({}).limit(50);\n`;
}

export function collectionDocumentsOwnerId(tabId: string): string {
  return `${tabId}:documents`;
}
