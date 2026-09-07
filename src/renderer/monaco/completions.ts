import * as monaco from 'monaco-editor';
import {
  buildSemanticSuggestions,
  contextNeedsSchema,
  detectCompletionContext,
  type SemanticCompletionData,
  type SemanticSuggestion,
} from '../../features/script-analysis/index.js';
import { useConnectionStore } from '../stores/connections.js';
import { useEditorContext } from '../stores/editor-context.js';
import { useSchemaCache } from '../stores/schema-cache.js';
import { bsonConstructorSuggestions } from './criteria-completions.js';
import { useSettingsStore } from '../stores/settings.js';
import { orderCatalogEntries } from '../catalog-order.js';

export function registerSchemaCompletions(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ['"', "'", '{', ',', '$'],

    provideCompletionItems: async (model, position, _completionContext, token) => {
      const source = model.getValue();
      const offset = model.getOffsetAt(position);
      const semanticContext = detectCompletionContext(source, offset, 'typescript');
      const editorContext = useEditorContext.getState();
      const connectionId = editorContext.connectionId;
      const database = editorContext.database ?? 'admin';
      const data: SemanticCompletionData = {};

      if (connectionId && semanticContext.kind === 'database-name') {
        await useConnectionStore.getState().loadDatabases(connectionId);
        if (token.isCancellationRequested) return { suggestions: [] };
        data.databaseNames = orderCatalogEntries(
          useConnectionStore.getState().databases[connectionId] ?? [],
          useSettingsStore.getState().settings.catalog.databaseOrder,
        )
          .map((candidate) => candidate.name);
      }

      if (connectionId && semanticContext.kind === 'collection-name') {
        await useConnectionStore.getState().loadCollections(connectionId, database);
        if (token.isCancellationRequested) return { suggestions: [] };
        data.collectionNames = orderCatalogEntries(
          useConnectionStore.getState().collections[`${connectionId}:${database}`] ?? [],
          useSettingsStore.getState().settings.catalog.collectionOrder,
        ).map((candidate) => candidate.name);
      }

      if (connectionId && contextNeedsSchema(semanticContext)) {
        const cached = useSchemaCache.getState().getSchema(
          connectionId,
          database,
          semanticContext.collection,
        );
        try {
          const snapshot = cached ?? await useSchemaCache.getState().loadSchema(
            connectionId,
            database,
            semanticContext.collection,
          );
          if (token.isCancellationRequested) return { suggestions: [] };
          data.fields = snapshot.fields;
        } catch {
          // Schema inference is advisory. Driver/keyword completions continue
          // working when sampling is unauthorized, times out, or disconnects.
        }
      }

      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const line = model.getLineContent(position.lineNumber);
      const precedingCharacter = line.charAt(Math.max(0, word.startColumn - 2));
      const insideQuotedToken = precedingCharacter === '"' || precedingCharacter === "'";

      return {
        suggestions: [
          ...bsonConstructorSuggestions.map((suggestion) => ({
            label: suggestion.label,
            insertText: suggestion.insertText,
            range,
            kind: monaco.languages.CompletionItemKind.Constructor,
            detail: suggestion.detail,
            sortText: `z-${suggestion.label}`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          } satisfies monaco.languages.CompletionItem)),
          ...buildSemanticSuggestions(semanticContext, data).map((suggestion) =>
            toMonacoSuggestion(suggestion, range, precedingCharacter, insideQuotedToken),
          ),
        ],
      };
    },
  });
}

function toMonacoSuggestion(
  suggestion: SemanticSuggestion,
  range: monaco.IRange,
  precedingCharacter: string,
  insideQuotedToken: boolean,
): monaco.languages.CompletionItem {
  let insertText = suggestion.insertText;
  if (
    (suggestion.kind === 'operator' || suggestion.kind === 'stage') &&
    precedingCharacter === '$' &&
    insertText.startsWith('$')
  ) {
    insertText = insertText.slice(1);
  }
  if (
    suggestion.kind === 'field' &&
    !insideQuotedToken &&
    !/^[$A-Z_a-z][$\w]*$/.test(insertText)
  ) {
    insertText = JSON.stringify(insertText);
  }

  return {
    label: suggestion.label,
    insertText,
    range,
    kind: monacoKind(suggestion.kind),
    detail: suggestion.detail,
    ...(suggestion.documentation
      ? { documentation: { value: suggestion.documentation } }
      : {}),
    ...(suggestion.sortText ? { sortText: suggestion.sortText } : {}),
    ...(suggestion.snippet
      ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
      : {}),
  } satisfies monaco.languages.CompletionItem;
}

function monacoKind(kind: SemanticSuggestion['kind']): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'field':
    case 'field-reference':
      return monaco.languages.CompletionItemKind.Field;
    case 'operator':
      return monaco.languages.CompletionItemKind.Operator;
    case 'stage':
      return monaco.languages.CompletionItemKind.Keyword;
    case 'collection':
    case 'database':
      return monaco.languages.CompletionItemKind.Module;
  }
}
