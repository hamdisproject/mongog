import { describe, expect, it } from 'vitest';
import type { WorkspaceTab } from '../../../src/shared/domain/index.js';
import { persistedWorkspaceFingerprint } from '../../../src/renderer/workspace-persistence.js';

const tab: WorkspaceTab = {
  id: 'tab-1',
  kind: 'collection',
  title: 'inventory',
  connectionId: 'conn-1',
  database: 'shop',
  collection: 'inventory',
  collectionViewMode: 'documents',
  documentsState: {
    draft: { filter: '{}', sort: '', projection: '' },
    applied: { filter: '{}', sort: '', projection: '' },
  },
};
const base = { tabs: [tab], activeTabId: 'tab-1', sidebarWidth: 280 };

describe('persisted workspace fingerprint', () => {
  it('ignores renderer-only tab fields that main never stores', () => {
    const rendererOnly = {
      ...base,
      tabs: [{
        ...tab,
        documentsColumnOrder: ['_id', 'sku'],
        documentsColumnOrderManual: true,
        documentsCriteriaOpen: false,
        documentsPageSizeOverride: 25,
        autoExecuteOnOpen: true,
      }],
    };
    expect(persistedWorkspaceFingerprint(rendererOnly)).toBe(persistedWorkspaceFingerprint(base));
  });

  it.each([
    ['title', { ...base, tabs: [{ ...tab, title: 'renamed' }] }],
    ['criteria', { ...base, tabs: [{ ...tab, documentsState: { ...tab.documentsState!, draft: { filter: '{ a: 1 }', sort: '', projection: '' } } }] }],
    ['active tab', { ...base, activeTabId: null }],
    ['sidebar width', { ...base, sidebarWidth: 300 }],
  ])('changes when persisted %s changes', (_label, changed) => {
    expect(persistedWorkspaceFingerprint(changed)).not.toBe(persistedWorkspaceFingerprint(base));
  });

  it('returns null for a state main would reject, so the save is still attempted', () => {
    expect(persistedWorkspaceFingerprint({ ...base, sidebarWidth: 10 })).toBeNull();
  });
});
