import type {
  CreateSavedItemInput,
  SavedItem,
  SavedItemType,
  WorkspaceTab,
} from '../shared/domain/index.js';
import { emptyDocumentCriteriaState } from './collection-workspace.js';

export function savedInputForTab(
  tab: WorkspaceTab,
  type: SavedItemType,
  existing?: SavedItem,
  sourceOverride?: string,
): CreateSavedItemInput {
  const common = {
    name: existing?.name ?? defaultSavedName(tab, type),
    folderId: existing?.folderId ?? null,
    connectionId: tab.connectionId,
    database: tab.database ?? null,
    collection: tab.collection ?? null,
    tags: existing?.tags ?? [],
  };

  if (type === 'query') {
    return {
      ...common,
      type,
      payload: {
        type,
        source: sourceOverride ?? tab.editorContent ?? '',
        language: existing?.payload.type === 'query' ? existing.payload.language : 'typescript',
        mode: tab.mode ?? 'query',
      },
    };
  }

  if (type === 'documents') {
    const criteria = tab.documentsState?.applied ?? emptyDocumentCriteriaState().applied;
    return {
      ...common,
      type,
      payload: { type, criteria: { ...criteria } },
    };
  }

  return {
    ...common,
    type,
    payload: {
      type,
      template: {
        kind: tab.kind === 'collection' ? 'collection' : 'query',
        title: tab.title,
        pinned: tab.pinned ?? false,
        customTitle: tab.customTitle ?? false,
        ...(tab.kind === 'collection'
          ? {
              collectionViewMode: tab.collectionViewMode ?? 'documents',
              documentsState: structuredClone(tab.documentsState ?? emptyDocumentCriteriaState()),
            }
          : {}),
        ...(tab.editorContent !== undefined ? { editorContent: tab.editorContent } : {}),
        ...(tab.mode !== undefined ? { mode: tab.mode } : {}),
      },
    },
  };
}

export function defaultSavedName(tab: WorkspaceTab, type: SavedItemType): string {
  const title = tab.title.trim();
  if (title && title !== 'Untitled') return title.slice(0, 120);
  if (type === 'documents' && tab.collection) return `${tab.collection} view`.slice(0, 120);
  if (type === 'tab') return 'Saved tab';
  return 'Saved query';
}

export function savedFolderPath(
  folderId: string | null,
  folders: Array<{ id: string; name: string; parentId: string | null }>,
): string {
  if (!folderId) return 'Saved';
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = folders.find((folder) => folder.id === folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parentId
      ? folders.find((folder) => folder.id === current!.parentId)
      : undefined;
  }
  return ['Saved', ...parts].join(' / ');
}

