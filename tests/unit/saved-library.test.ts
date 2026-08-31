import { describe, expect, it } from 'vitest';
import {
  savedCreateFolderSchema,
  savedCreateItemSchema,
  savedUpdateItemSchema,
} from '../../src/shared/ipc/index.js';
import { savedInputForTab, savedFolderPath } from '../../src/renderer/saved-item-utils.js';

describe('saved library contracts', () => {
  it('accepts typed query, documents, and tab payloads', () => {
    const common = {
      name: 'Saved item', folderId: null, connectionId: 'conn-1', database: 'db', collection: 'items', tags: [],
    };
    expect(savedCreateItemSchema.safeParse({
      ...common, type: 'query',
      payload: { type: 'query', source: 'db.items.find({})', language: 'typescript', mode: 'query' },
    }).success).toBe(true);
    expect(savedCreateItemSchema.safeParse({
      ...common, type: 'documents',
      payload: { type: 'documents', criteria: { filter: '{ active: true }', sort: '', projection: '' } },
    }).success).toBe(true);
    expect(savedUpdateItemSchema.safeParse({
      id: 'item-1', ...common, type: 'tab',
      payload: {
        type: 'tab', template: {
          kind: 'collection', title: 'Items', pinned: true, customTitle: true,
          collectionViewMode: 'documents',
          documentsState: {
            draft: { filter: '{}', sort: '', projection: '' },
            applied: { filter: '{}', sort: '', projection: '' },
          },
        },
      },
    }).success).toBe(true);
  });

  it('rejects mismatched payload types and invalid names', () => {
    expect(savedCreateItemSchema.safeParse({
      name: 'Mismatch', type: 'query', folderId: null, connectionId: null,
      database: null, collection: null, tags: [],
      payload: { type: 'documents', criteria: { filter: '{}', sort: '', projection: '' } },
    }).success).toBe(false);
    expect(savedCreateFolderSchema.safeParse({ name: '   ', connectionId: null, parentId: null }).success).toBe(false);
  });

  it('builds reusable saved payloads without execution results', () => {
    const input = savedInputForTab({
      id: 'tab-1', kind: 'collection', title: 'Filtered inventory', connectionId: 'conn-1',
      database: 'shop', collection: 'inventory', collectionViewMode: 'documents', pinned: true,
      customTitle: true, dirty: true,
      documentsState: {
        draft: { filter: '{ sku: "edited" }', sort: '', projection: '' },
        applied: { filter: '{ sku: "alpha" }', sort: '{ createdAt: -1 }', projection: '{ sku: 1 }' },
      },
    }, 'tab');
    expect(input).toMatchObject({
      type: 'tab', connectionId: 'conn-1', database: 'shop', collection: 'inventory',
      payload: {
        type: 'tab', template: {
          kind: 'collection', pinned: true, title: 'Filtered inventory',
          documentsState: {
            draft: { filter: '{ sku: "edited" }' },
            applied: { filter: '{ sku: "alpha" }' },
          },
        },
      },
    });
    expect(JSON.stringify(input)).not.toContain('statementResults');
  });

  it('formats a nested folder path', () => {
    expect(savedFolderPath('child', [
      { id: 'root', name: 'Reports', parentId: null },
      { id: 'child', name: 'Daily', parentId: 'root' },
    ])).toBe('Saved / Reports / Daily');
  });

  it('omits transient Criteria visibility from saved tab templates', () => {
    const input = savedInputForTab({
      id: 'tab-1', kind: 'collection', title: 'db.items', connectionId: 'conn-1',
      database: 'db', collection: 'items', documentsCriteriaOpen: false,
    }, 'tab');
    expect(JSON.stringify(input)).not.toContain('documentsCriteriaOpen');
  });
});
