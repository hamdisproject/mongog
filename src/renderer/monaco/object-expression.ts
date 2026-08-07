import * as monaco from 'monaco-editor';
import {
  buildSemanticSuggestions,
  detectCompletionContext,
  type SemanticSuggestion,
} from '../../features/script-analysis/index.js';
import { useSchemaCache } from '../stores/schema-cache.js';
import {
  buildCriteriaVirtualSource,
  criteriaSuggestionInsertText,
  type CriteriaKind,
} from './criteria-completions.js';

export type { CriteriaKind } from './criteria-completions.js';

export const OBJECT_EXPRESSION_LANGUAGE = 'mongog-object-expression';

export interface ObjectExpressionContext {
  connectionId: string;
  database: string;
  collection: string;
  kind: CriteriaKind;
}

const modelContexts = new Map<string, ObjectExpressionContext>();

export function registerObjectExpressionLanguage(): monaco.IDisposable {
  monaco.languages.register({ id: OBJECT_EXPRESSION_LANGUAGE });
  const disposables: monaco.IDisposable[] = [
    monaco.languages.setLanguageConfiguration(OBJECT_EXPRESSION_LANGUAGE, {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    }),
    monaco.languages.setMonarchTokensProvider(OBJECT_EXPRESSION_LANGUAGE, {
      defaultToken: 'invalid',
      tokenPostfix: '.mongog-object-expression',
      keywords: ['true', 'false', 'null'],
      tokenizer: {
        root: [
          [/\s+/, 'white'],
          [/\/\*/, 'comment', '@comment'],
          [/\/\/.*/, 'comment'],
          [/[{}\[\]()]/, '@brackets'],
          [/[,:]/, 'delimiter'],
          [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
          [/"/, 'string', '@doubleString'],
          [/'/, 'string', '@singleString'],
          [/\$[A-Z_a-z][$\w]*/, 'keyword'],
          [/[A-Z_a-z][$\w]*/, { cases: { '@keywords': 'keyword', '@default': 'type.identifier' } }],
        ],
        comment: [
          [/[^*/]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[*/]/, 'comment'],
        ],
        doubleString: [
          [/[^\\"]+/, 'string'],
          [/\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4})/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/"/, 'string', '@pop'],
        ],
        singleString: [
          [/[^\\']+/, 'string'],
          [/\\(?:['\\/bfnrt]|u[0-9A-Fa-f]{4})/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/'/, 'string', '@pop'],
        ],
      },
    }),
    monaco.languages.registerCompletionItemProvider(OBJECT_EXPRESSION_LANGUAGE, {
      triggerCharacters: ['"', "'", '{', ',', '$'],
      provideCompletionItems: async (model, position, _completionContext, token) => {
        const criteriaContext = modelContexts.get(model.uri.toString());
        if (!criteriaContext) return { suggestions: [] };

        const source = model.getValue();
        const sourceOffset = model.getOffsetAt(position);
        const virtual = buildCriteriaVirtualSource(source, sourceOffset, criteriaContext);
        const semanticContext = detectCompletionContext(
          virtual.source,
          virtual.offset,
          'typescript',
        );
        const cached = useSchemaCache.getState().getSchema(
          criteriaContext.connectionId,
          criteriaContext.database,
          criteriaContext.collection,
        );
        let fields = cached?.fields;
        if (!fields) {
          try {
            fields = (await useSchemaCache.getState().loadSchema(
              criteriaContext.connectionId,
              criteriaContext.database,
              criteriaContext.collection,
            )).fields;
          } catch {
            // Schema inference is advisory; literal and operator editing remain available.
          }
        }
        if (token.isCancellationRequested) return { suggestions: [] };

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
          suggestions: buildSemanticSuggestions(semanticContext, { fields })
            .filter((suggestion) => suggestion.label !== '$where')
            .map((suggestion) => toCriteriaSuggestion(
              suggestion,
              range,
              precedingCharacter,
              insideQuotedToken,
            )),
        };
      },
    }),
  ];

  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) };
}

export function registerObjectExpressionModel(
  model: monaco.editor.ITextModel,
  context: ObjectExpressionContext,
): monaco.IDisposable {
  const key = model.uri.toString();
  modelContexts.set(key, context);
  return {
    dispose: () => {
      if (modelContexts.get(key) === context) modelContexts.delete(key);
    },
  };
}

function toCriteriaSuggestion(
  suggestion: SemanticSuggestion,
  range: monaco.IRange,
  precedingCharacter: string,
  insideQuotedToken: boolean,
): monaco.languages.CompletionItem {
  return {
    label: suggestion.label,
    insertText: criteriaSuggestionInsertText(
      suggestion,
      precedingCharacter,
      insideQuotedToken,
    ),
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
