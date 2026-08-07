import type { SemanticSuggestion } from '../../features/script-analysis/index.js';

export type CriteriaKind = 'filter' | 'sort' | 'projection';

export interface CriteriaVirtualContext {
  collection: string;
  kind: CriteriaKind;
}

export function buildCriteriaVirtualSource(
  source: string,
  offset: number,
  context: CriteriaVirtualContext,
): { source: string; offset: number } {
  const collection = JSON.stringify(context.collection);
  const prefix = context.kind === 'filter'
    ? `db.collection(${collection}).find(`
    : context.kind === 'sort'
      ? `db.collection(${collection}).find({}).sort(`
      : `db.collection(${collection}).find({}).project(`;
  return {
    source: `${prefix}${source}\n);`,
    offset: prefix.length + Math.max(0, Math.min(source.length, offset)),
  };
}

export function criteriaSuggestionInsertText(
  suggestion: Pick<SemanticSuggestion, 'kind' | 'insertText'>,
  precedingCharacter: string,
  insideQuotedToken: boolean,
): string {
  let insertText = suggestion.insertText;
  if (
    suggestion.kind === 'operator' &&
    precedingCharacter === '$' &&
    insertText.startsWith('$')
  ) {
    insertText = insertText.slice(1);
  }
  if (
    suggestion.kind === 'field' &&
    !insideQuotedToken &&
    !/^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u.test(insertText)
  ) {
    insertText = JSON.stringify(insertText);
  }
  return insertText;
}
