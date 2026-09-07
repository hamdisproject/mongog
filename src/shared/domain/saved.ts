export const MAX_SAVED_FOLDER_DEPTH = 32;

export interface DocumentCriteriaText {
  filter: string;
  sort: string;
  projection: string;
}

export interface DocumentCriteriaState {
  draft: DocumentCriteriaText;
  applied: DocumentCriteriaText;
}

export interface SavedQueryPayload {
  type: 'query';
  source: string;
  language: 'javascript' | 'typescript';
  mode: 'query' | 'trusted';
}

export interface SavedDocumentsPayload {
  type: 'documents';
  criteria: DocumentCriteriaText;
}

export interface SavedTabTemplate {
  kind: 'query' | 'sql' | 'collection';
  title: string;
  pinned: boolean;
  customTitle: boolean;
  collectionViewMode?: 'documents' | 'query' | 'sql';
  editorContent?: string;
  /** collection tabs saved while the SQL view is active */
  sqlEditorContent?: string;
  mode?: 'query' | 'trusted';
  documentsState?: DocumentCriteriaState;
}

export interface SavedTabPayload {
  type: 'tab';
  template: SavedTabTemplate;
}

export type SavedItemPayload = SavedQueryPayload | SavedDocumentsPayload | SavedTabPayload;
export type SavedItemType = SavedItemPayload['type'];

export interface SavedFolder {
  id: string;
  name: string;
  connectionId: string | null;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SavedItem {
  id: string;
  name: string;
  type: SavedItemType;
  folderId: string | null;
  connectionId: string | null;
  database: string | null;
  collection: string | null;
  tags: string[];
  payload: SavedItemPayload;
  createdAt: number;
  updatedAt: number;
}

export interface SavedLibrarySnapshot {
  folders: SavedFolder[];
  items: SavedItem[];
}

export interface CreateSavedFolderInput {
  name: string;
  connectionId: string | null;
  parentId: string | null;
}

export interface UpdateSavedFolderInput extends CreateSavedFolderInput {
  id: string;
}

export interface CreateSavedItemInput {
  name: string;
  type: SavedItemType;
  folderId: string | null;
  connectionId: string | null;
  database: string | null;
  collection: string | null;
  tags: string[];
  payload: SavedItemPayload;
}

export interface UpdateSavedItemInput extends CreateSavedItemInput {
  id: string;
}

export interface DeleteSavedFolderResult {
  deletedFolderIds: string[];
  deletedItemIds: string[];
}
