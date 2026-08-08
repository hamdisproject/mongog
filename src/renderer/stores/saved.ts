import { create } from 'zustand';
import type {
  CreateSavedFolderInput,
  CreateSavedItemInput,
  SavedFolder,
  SavedItem,
  UpdateSavedFolderInput,
  UpdateSavedItemInput,
} from '../../shared/domain/index.js';
import { useWorkspaceStore } from './workspace.js';

interface SavedLibraryState {
  folders: SavedFolder[];
  items: SavedItem[];
  expandedNodeIds: Set<string>;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  toggleNode: (id: string) => void;
  setNodeExpanded: (id: string, expanded: boolean) => void;
  createFolder: (input: CreateSavedFolderInput) => Promise<SavedFolder>;
  updateFolder: (input: UpdateSavedFolderInput) => Promise<SavedFolder>;
  deleteFolder: (id: string) => Promise<void>;
  createItem: (input: CreateSavedItemInput) => Promise<SavedItem>;
  updateItem: (input: UpdateSavedItemInput) => Promise<SavedItem>;
  deleteItem: (id: string) => Promise<void>;
  openItem: (id: string) => string | null;
  clearError: () => void;
}

export const savedRootNodeId = (connectionId: string | null): string => (
  `saved-root:${connectionId ?? 'unassigned'}`
);

function replaceById<T extends { id: string }>(items: T[], value: T): T[] {
  return items.map((item) => (item.id === value.id ? value : item));
}

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export const useSavedLibraryStore = create<SavedLibraryState>()((set, get) => ({
  folders: [],
  items: [],
  expandedNodeIds: new Set(),
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await window.mongog.saved.list();
      set({ folders: snapshot.folders, items: snapshot.items });
      const valid = new Set(snapshot.items.map((item) => item.id));
      const missing = useWorkspaceStore.getState().tabs
        .map((tab) => tab.savedItemId)
        .filter((id): id is string => !!id && !valid.has(id));
      useWorkspaceStore.getState().detachSavedItems(missing);
      syncOpenTabs(snapshot.items);
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ loading: false });
    }
  },

  toggleNode: (id) => {
    const expandedNodeIds = new Set(get().expandedNodeIds);
    if (expandedNodeIds.has(id)) expandedNodeIds.delete(id);
    else expandedNodeIds.add(id);
    set({ expandedNodeIds });
  },

  setNodeExpanded: (id, expanded) => {
    const expandedNodeIds = new Set(get().expandedNodeIds);
    if (expanded) expandedNodeIds.add(id); else expandedNodeIds.delete(id);
    set({ expandedNodeIds });
  },

  createFolder: async (input) => {
    set({ error: null });
    try {
      const folder = await window.mongog.saved.createFolder(input);
      set((state) => ({ folders: [...state.folders, folder] }));
      get().setNodeExpanded(input.parentId ?? savedRootNodeId(input.connectionId), true);
      return folder;
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  updateFolder: async (input) => {
    set({ error: null });
    try {
      const folder = await window.mongog.saved.updateFolder(input);
      await get().load();
      return folder;
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  deleteFolder: async (id) => {
    set({ error: null });
    try {
      const result = await window.mongog.saved.deleteFolder(id);
      const deletedFolders = new Set(result.deletedFolderIds);
      const deletedItems = new Set(result.deletedItemIds);
      set((state) => ({
        folders: state.folders.filter((folder) => !deletedFolders.has(folder.id)),
        items: state.items.filter((item) => !deletedItems.has(item.id)),
      }));
      useWorkspaceStore.getState().detachSavedItems(result.deletedItemIds);
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  createItem: async (input) => {
    set({ error: null });
    try {
      const item = await window.mongog.saved.createItem(input);
      set((state) => ({ items: [...state.items, item] }));
      get().setNodeExpanded(input.folderId ?? savedRootNodeId(input.connectionId), true);
      return item;
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  updateItem: async (input) => {
    set({ error: null });
    try {
      const item = await window.mongog.saved.updateItem(input);
      set((state) => ({ items: replaceById(state.items, item) }));
      syncOpenTabs([item]);
      return item;
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  deleteItem: async (id) => {
    set({ error: null });
    try {
      await window.mongog.saved.deleteItem(id);
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      useWorkspaceStore.getState().detachSavedItems([id]);
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  openItem: (id) => {
    const item = get().items.find((candidate) => candidate.id === id);
    return item ? useWorkspaceStore.getState().openSavedItem(item) : null;
  },

  clearError: () => set({ error: null }),
}));

function syncOpenTabs(items: SavedItem[]): void {
  const store = useWorkspaceStore.getState();
  for (const item of items) {
    const tab = store.tabs.find((candidate) => candidate.savedItemId === item.id);
    if (!tab) continue;
    store.updateTab(tab.id, {
      connectionId: item.connectionId,
      database: item.database ?? undefined,
      collection: item.collection ?? undefined,
    });
  }
}
