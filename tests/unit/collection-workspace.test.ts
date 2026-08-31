import { describe, expect, it } from 'vitest';
import {
  collectionDocumentsOwnerId,
  collectionPageSizeOptions,
  collectionQueryTemplate,
  extractCollectionColumns,
  reconcileCollectionColumns,
  renameCollectionQueryTemplate,
} from '../../src/renderer/collection-workspace.js';
import { parseScript } from '../../src/features/script-analysis/parse.js';
import { workspaceSaveSchema } from '../../src/shared/ipc/index.js';

describe('collection workspace helpers', () => {
  it('creates a syntactically valid query for collection names requiring escaping', () => {
    const collection = 'quotes"/slash/üñîçødé';
    const source = collectionQueryTemplate(collection);

    expect(source).toBe(`db.collection(${JSON.stringify(collection)}).find({}).limit(50);\n`);
    expect(parseScript(source).diagnostics).toEqual([]);
  });

  it('uses the configured page size and preserves it when an untouched template is renamed', () => {
    const source = collectionQueryTemplate('old/name', 125);
    expect(source).toBe('db.collection("old/name").find({}).limit(125);\n');
    expect(renameCollectionQueryTemplate(source, 'old/name', 'new/name'))
      .toBe('db.collection("new/name").find({}).limit(125);\n');
    expect(renameCollectionQueryTemplate(`${source}// edited`, 'old/name', 'new/name'))
      .toBe(`${source}// edited`);
  });

  it('keeps document cursor ownership separate from query ownership', () => {
    expect(collectionDocumentsOwnerId('tab-42')).toBe('tab-42:documents');
    expect(collectionDocumentsOwnerId('tab-42')).not.toBe('tab-42');
  });

  it('builds ordered page-size choices without duplicating the global default', () => {
    expect(collectionPageSizeOptions(50)).toEqual([
      { value: 'default', pageSize: 50, label: 'Default · 50' },
      { value: '10', pageSize: 10, label: '10' },
      { value: '25', pageSize: 25, label: '25' },
      { value: '100', pageSize: 100, label: '100' },
      { value: '250', pageSize: 250, label: '250' },
      { value: '500', pageSize: 500, label: '500' },
    ]);
    expect(collectionPageSizeOptions(125).map((option) => option.pageSize))
      .toEqual([125, 10, 25, 50, 100, 250, 500]);
  });

  it('keeps the last non-empty Documents columns when a filter returns no rows', () => {
    const previous = ['_id', 'sku', 'quantity'];
    expect(extractCollectionColumns([])).toEqual([]);
    expect(reconcileCollectionColumns(previous, [])).toBe(previous);
    expect(reconcileCollectionColumns([], [])).toEqual([]);
  });

  it('discovers a stable top-level schema from a non-empty Documents page', () => {
    expect(extractCollectionColumns([{ sku: 'a', quantity: 1 }, { sku: 'b', note: 'new' }]))
      .toEqual(['_id', 'note', 'quantity', 'sku']);
  });

  it('uses first-seen field order across heterogeneous documents in document mode', () => {
    expect(extractCollectionColumns([
      { sku: 'a', quantity: 1 },
      { sku: 'b', note: 'new', amenities: [] },
    ], 'document')).toEqual(['_id', 'sku', 'quantity', 'note', 'amenities']);
  });

  it('applies a new automatic order while removing columns absent from a non-empty page', () => {
    expect(reconcileCollectionColumns(['quantity', '_id', 'legacy'], ['_id', 'sku', 'quantity']))
      .toEqual(['_id', 'sku', 'quantity']);
  });

  it('preserves a manual order and appends newly discovered columns', () => {
    expect(reconcileCollectionColumns(
      ['quantity', '_id', 'legacy'],
      ['_id', 'sku', 'quantity'],
      true,
    ))
      .toEqual(['quantity', '_id', 'sku']);
  });

  it('accepts the persisted collection view mode', () => {
    expect(workspaceSaveSchema.safeParse({
      state: {
        sidebarWidth: 320,
        tabs: [{
          id: 'tab-1',
          kind: 'collection',
          title: 'db.items',
          connectionId: 'conn-1',
          database: 'db',
          collection: 'items',
          collectionViewMode: 'query',
          autoExecuteOnOpen: true,
          documentsPageSizeOverride: 100,
          documentsColumnOrder: ['_id', 'quantity', 'sku'],
          documentsColumnOrderManual: true,
          editorContent: 'db.collection("items").find({});',
          savedItemId: 'saved-view-1',
          documentsState: {
            draft: { filter: '{ sku: "alpha" }', sort: '{ createdAt: -1 }', projection: '' },
            applied: { filter: '{ sku: "alpha" }', sort: '{ createdAt: -1 }', projection: '' },
          },
          pinned: true,
          customTitle: true,
        }],
        activeTabId: 'tab-1',
      },
    }).success).toBe(true);
    const parsed = workspaceSaveSchema.parse({
      state: {
        sidebarWidth: 260,
        tabs: [{
          id: 'runtime-only', kind: 'collection', title: 'db.items', connectionId: 'conn-1',
          collectionViewMode: 'query', autoExecuteOnOpen: true, documentsPageSizeOverride: 100,
          documentsColumnOrder: ['_id', 'quantity', 'sku'], documentsColumnOrderManual: true,
          documentsCriteriaOpen: false,
        }],
        activeTabId: 'runtime-only',
      },
    });
    expect('autoExecuteOnOpen' in parsed.state.tabs[0]!).toBe(false);
    expect('documentsPageSizeOverride' in parsed.state.tabs[0]!).toBe(false);
    expect('documentsColumnOrder' in parsed.state.tabs[0]!).toBe(false);
    expect('documentsColumnOrderManual' in parsed.state.tabs[0]!).toBe(false);
    expect('documentsCriteriaOpen' in parsed.state.tabs[0]!).toBe(false);
  });

  it('accepts a persisted namespace-locked change stream tab', () => {
    expect(workspaceSaveSchema.safeParse({
      state: {
        sidebarWidth: 260,
        tabs: [{
          id: 'changes-1',
          kind: 'change-stream',
          title: 'Changes · db.items',
          connectionId: 'conn-1',
          database: 'db',
          collection: 'items',
        }],
        activeTabId: 'changes-1',
      },
    }).success).toBe(true);
  });

  it('accepts a persisted Release Notes tab', () => {
    expect(workspaceSaveSchema.safeParse({
      state: {
        sidebarWidth: 260,
        tabs: [{
          id: 'release-notes-1',
          kind: 'release-notes',
          title: 'Release Notes',
          connectionId: null,
          pinned: true,
        }],
        activeTabId: 'release-notes-1',
      },
    }).success).toBe(true);
  });
});
