import { describe, expect, it } from 'vitest';
import { MAX_SQL_SOURCE_BYTES } from '../../../src/shared/domain/index.js';
import {
  connExecuteSchema,
  connExecuteSqlSchema,
  savedCreateItemSchema,
  workspaceSaveSchema,
} from '../../../src/shared/ipc/index.js';

const sqlRequest = {
  connectionId: 'conn-1',
  database: 'shop',
  source: 'SELECT * FROM items LIMIT 10',
  pageSize: 50,
};

describe('SQL IPC contracts', () => {
  it('accepts raw SQL but rejects renderer-supplied policy or generated source', () => {
    expect(connExecuteSqlSchema.safeParse(sqlRequest).success).toBe(true);
    expect(connExecuteSqlSchema.safeParse({ ...sqlRequest, readOnly: false }).success).toBe(false);
    expect(connExecuteSqlSchema.safeParse({ ...sqlRequest, mode: 'trusted' }).success).toBe(false);
    expect(connExecuteSqlSchema.safeParse({ ...sqlRequest, jsSource: 'db.collection("x").drop()' }).success).toBe(false);
  });

  it('rejects readOnly on the generic renderer execution contract', () => {
    expect(connExecuteSchema.safeParse({
      connectionId: 'conn-1', database: 'shop', mode: 'query', source: '1;',
      sourceOffset: { line: 0, column: 0 }, readOnly: false,
    }).success).toBe(false);
  });

  it('enforces the UTF-8 SQL byte limit', () => {
    expect(connExecuteSqlSchema.safeParse({ ...sqlRequest, source: 'x'.repeat(MAX_SQL_SOURCE_BYTES) }).success).toBe(true);
    expect(connExecuteSqlSchema.safeParse({ ...sqlRequest, source: 'é'.repeat(MAX_SQL_SOURCE_BYTES / 2 + 1) }).success).toBe(false);
  });

  it('preserves collection SQL source through workspace validation', () => {
    const parsed = workspaceSaveSchema.parse({
      state: {
        sidebarWidth: 260,
        tabs: [{
          id: 'tab-1', kind: 'collection', title: 'shop.items', connectionId: 'conn-1',
          database: 'shop', collection: 'items', collectionViewMode: 'sql',
          editorContent: 'db.collection("items").find({});',
          sqlEditorContent: 'SELECT * FROM items LIMIT 10;',
        }],
        activeTabId: 'tab-1',
      },
    });
    expect(parsed.state.tabs[0]?.sqlEditorContent).toBe('SELECT * FROM items LIMIT 10;');
  });

  it('accepts a reusable standalone SQL tab and applies its source limit', () => {
    const base = {
      name: 'SQL report', type: 'tab' as const, folderId: null, connectionId: 'conn-1',
      database: 'shop', collection: null, tags: [],
    };
    expect(savedCreateItemSchema.safeParse({
      ...base,
      payload: {
        type: 'tab',
        template: {
          kind: 'sql', title: 'SQL report', pinned: false, customTitle: true,
          editorContent: 'SELECT * FROM items LIMIT 10;',
        },
      },
    }).success).toBe(true);
    expect(savedCreateItemSchema.safeParse({
      ...base,
      payload: {
        type: 'tab',
        template: {
          kind: 'sql', title: 'Too large', pinned: false, customTitle: true,
          editorContent: 'x'.repeat(MAX_SQL_SOURCE_BYTES + 1),
        },
      },
    }).success).toBe(false);
  });
});
