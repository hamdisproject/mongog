import { describe, expect, it } from 'vitest';
import {
  collectionDocumentsOwnerId,
  collectionQueryTemplate,
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

  it('keeps document cursor ownership separate from query ownership', () => {
    expect(collectionDocumentsOwnerId('tab-42')).toBe('tab-42:documents');
    expect(collectionDocumentsOwnerId('tab-42')).not.toBe('tab-42');
  });

  it('accepts the persisted collection view mode', () => {
    expect(workspaceSaveSchema.safeParse({
      state: {
        tabs: [{
          id: 'tab-1',
          kind: 'collection',
          title: 'db.items',
          connectionId: 'conn-1',
          database: 'db',
          collection: 'items',
          collectionViewMode: 'query',
          editorContent: 'db.collection("items").find({});',
        }],
        activeTabId: 'tab-1',
      },
    }).success).toBe(true);
  });
});
