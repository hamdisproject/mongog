import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../../src/renderer/stores/workspace.js';
import { resetWorkspaceStores } from './helpers/workspace.js';

beforeEach(resetWorkspaceStores);

describe('workspace execution store', () => {
  it('opens each saved item type once and restores reusable tab state', () => {
    const query = {
      id: 'saved-query', name: 'Daily query', type: 'query' as const, folderId: null,
      connectionId: 'conn-1', database: 'analytics', collection: null, tags: [],
      payload: { type: 'query' as const, source: 'db.events.find({ active: true })', language: 'typescript' as const, mode: 'query' as const },
      createdAt: 1, updatedAt: 1,
    };
    const queryTab = useWorkspaceStore.getState().openSavedItem(query);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === queryTab)).toMatchObject({
      kind: 'query', title: 'Daily query', savedItemId: 'saved-query', connectionId: 'conn-1',
      database: 'analytics', editorContent: 'db.events.find({ active: true })', dirty: false,
    });
    expect(useWorkspaceStore.getState().openSavedItem(query)).toBe(queryTab);

    const documentsTab = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-documents', name: 'Active inventory', type: 'documents', folderId: null,
      connectionId: 'conn-1', database: 'shop', collection: 'inventory', tags: [],
      payload: { type: 'documents', criteria: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' } },
      createdAt: 1, updatedAt: 1,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === documentsTab)).toMatchObject({
      kind: 'collection', savedItemId: 'saved-documents', collectionViewMode: 'documents',
      documentsState: {
        draft: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' },
        applied: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' },
      },
    });

    const templateTab = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-tab', name: 'Pinned template', type: 'tab', folderId: null,
      connectionId: null, database: 'shop', collection: 'inventory', tags: [],
      payload: {
        type: 'tab',
        template: {
          kind: 'collection', title: 'Inventory workspace', pinned: true, customTitle: true,
          collectionViewMode: 'query', editorContent: 'db.inventory.find({})', mode: 'query',
        },
      },
      createdAt: 1, updatedAt: 1,
    });
    expect(useWorkspaceStore.getState().tabs[0]?.id).toBe(templateTab);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === templateTab)).toMatchObject({
      savedItemId: 'saved-tab', pinned: true, dirty: false, connectionId: null,
      title: 'Inventory workspace', collectionViewMode: 'query',
    });
  });

  it('detaches deleted saved items without closing their tabs', () => {
    const tabId = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-query', name: 'Kept content', type: 'query', folderId: null,
      connectionId: null, database: null, collection: null, tags: [],
      payload: { type: 'query', source: 'db.test.find({})', language: 'typescript', mode: 'query' },
      createdAt: 1, updatedAt: 1,
    });
    useWorkspaceStore.getState().detachSavedItems(['saved-query']);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      editorContent: 'db.test.find({})', dirty: true,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)?.savedItemId).toBeUndefined();
  });
});
