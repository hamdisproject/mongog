import * as monaco from 'monaco-editor';
import {
  buildSqlSuggestions,
  collectionNameSuggestions,
  detectSqlCompletionContext,
  type SqlSchemaInput,
  type SqlSuggestion,
} from '../../features/sql-completion/index.js';
import { useConnectionStore } from '../stores/connections.js';
import { useSchemaCache } from '../stores/schema-cache.js';
import { useSettingsStore } from '../stores/settings.js';
import { orderCatalogEntries } from '../catalog-order.js';
import { useWorkspaceStore } from '../stores/workspace.js';

/** Max tables to sample per keystroke; the rest still complete from cache. */
const MAX_SCOPE_TABLES = 4;

export function registerSqlCompletions(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ',', '('],

    provideCompletionItems: async (model, position, _completionContext, token) => {
      const offset = model.getOffsetAt(position);
      const context = detectSqlCompletionContext(model.getValue(), offset);
      const tab = tabForSqlModel(model);
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const connectionId = tab?.connectionId ?? null;
      const database = tab?.database ?? 'admin';
      const defaultTable = tab?.kind === 'collection' ? tab.collection : undefined;
      if (!connectionId) {
        return {
          suggestions: buildSqlSuggestions(context, {
            collectionNames: [],
            databaseNames: [],
            schemas: [],
          }).map((suggestion) => toMonacoSuggestion(suggestion, range)),
        };
      }

      const connectionStore = useConnectionStore.getState();
      const settings = useSettingsStore.getState().settings;
      const databaseNames = orderCatalogEntries(
        connectionStore.databases[connectionId] ?? [],
        settings.catalog.databaseOrder,
      )
        .map((candidate) => candidate.name);

      // `db.|` completes that database's collections (needs no schema).
      const [root] = context.qualifierChain;
      if (context.kind === 'qualified' && root && databaseNames.includes(root) &&
        !context.tables.some((table) => table.alias === root || table.table === root)) {
        await connectionStore.loadCollections(connectionId, root);
        if (token.isCancellationRequested) return { suggestions: [] };
        const names = orderCatalogEntries(
          connectionStore.collections[`${connectionId}:${root}`] ?? [],
          settings.catalog.collectionOrder,
        )
          .map((candidate) => candidate.name);
        return {
          suggestions: collectionNameSuggestions(names)
            .map((suggestion) => toMonacoSuggestion(suggestion, range)),
        };
      }

      let collectionNames: string[] = [];
      if (context.kind === 'table') {
        await connectionStore.loadCollections(connectionId, database);
        if (token.isCancellationRequested) return { suggestions: [] };
        collectionNames = orderCatalogEntries(
          connectionStore.collections[`${connectionId}:${database}`] ?? [],
          settings.catalog.collectionOrder,
        )
          .map((candidate) => candidate.name);
      }

      // Schemas for in-scope tables (or the locked collection when the
      // statement names no table yet). Sampling is advisory: failures leave
      // keywords/collections working.
      const scopeTables = context.tables.length > 0
        ? context.tables.slice(0, MAX_SCOPE_TABLES)
        : defaultTable
          ? [{ table: defaultTable, alias: defaultTable, db: null as string | null }]
          : [];
      const schemas = (await Promise.all(scopeTables.map(async (table) => {
        try {
          const cached = useSchemaCache.getState().getSchema(
            connectionId,
            table.db ?? database,
            table.table,
          );
          const snapshot = cached ?? await useSchemaCache.getState().loadSchema(
            connectionId,
            table.db ?? database,
            table.table,
          );
          if (token.isCancellationRequested) return null;
          const schema: SqlSchemaInput = {
            table: table.table,
            alias: table.alias,
            db: table.db,
            fields: snapshot.fields,
          };
          return schema;
        } catch {
          return null;
        }
      }))).filter((schema): schema is SqlSchemaInput => schema !== null);

      return {
        suggestions: buildSqlSuggestions(context, {
          collectionNames,
          databaseNames,
          schemas,
        }).map((suggestion) => toMonacoSuggestion(suggestion, range)),
      };
    },
  });
}

/** Standalone `sql` tabs and locked collection SQL views resolve via model URI. */
function tabForSqlModel(model: monaco.editor.ITextModel) {
  const leaf = model.uri.path.split('/').pop() ?? '';
  const base = leaf.endsWith('.sql') ? leaf.slice(0, -'.sql'.length) : leaf;
  let tabId: string;
  try {
    tabId = decodeURIComponent(base);
  } catch {
    tabId = base;
  }
  if (!tabId) return undefined;
  const tab = useWorkspaceStore.getState().tabs.find((candidate) => candidate.id === tabId);
  return tab?.kind === 'sql' || tab?.kind === 'collection' ? tab : undefined;
}

function toMonacoSuggestion(
  suggestion: SqlSuggestion,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  return {
    label: suggestion.label,
    insertText: suggestion.insertText,
    range,
    kind: monacoKind(suggestion.kind),
    detail: suggestion.detail,
    ...(suggestion.documentation
      ? { documentation: { value: suggestion.documentation } }
      : {}),
    sortText: suggestion.sortText,
    ...(suggestion.snippet
      ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
      : {}),
  } satisfies monaco.languages.CompletionItem;
}

function monacoKind(kind: SqlSuggestion['kind']): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'field':
      return monaco.languages.CompletionItemKind.Field;
    case 'alias':
      return monaco.languages.CompletionItemKind.Variable;
    case 'table':
    case 'database':
      return monaco.languages.CompletionItemKind.Module;
    case 'function':
      return monaco.languages.CompletionItemKind.Function;
    case 'keyword':
      return monaco.languages.CompletionItemKind.Keyword;
  }
}
