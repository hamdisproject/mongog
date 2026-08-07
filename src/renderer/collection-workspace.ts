export type CollectionViewMode = 'documents' | 'query';

export function collectionQueryTemplate(collection: string): string {
  return `db.collection(${JSON.stringify(collection)}).find({}).limit(50);\n`;
}

export function collectionDocumentsOwnerId(tabId: string): string {
  return `${tabId}:documents`;
}
