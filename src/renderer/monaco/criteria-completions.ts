import type { CompletionContext, SemanticSuggestion } from '../../features/script-analysis/index.js';

export type CriteriaKind = 'filter' | 'sort' | 'projection';

export interface CriteriaVirtualContext {
  collection: string;
  kind: CriteriaKind;
}

export interface BsonConstructorSuggestion {
  label: string;
  insertText: string;
  detail: string;
}

/**
 * Only the helpers people reach for in filters. The parser, highlighter and
 * editor type declarations still accept every BSON helper when typed by hand.
 */
export const bsonConstructorSuggestions: readonly BsonConstructorSuggestion[] = [
  { label: 'ObjectId', insertText: 'ObjectId("${1:507f1f77bcf86cd799439011}")', detail: 'BSON ObjectId' },
  { label: 'ISODate', insertText: 'ISODate("${1:2026-01-01T00:00:00.000Z}")', detail: 'BSON Date' },
  { label: 'UUID', insertText: 'UUID("${1:00112233-4455-6677-8899-aabbccddeeff}")', detail: 'BSON UUID' },
] as const;

/** BSON helpers belong only where a Filter VALUE is typed, never in keys, Sort or Projection. */
export function criteriaConstructorSuggestions(
  kind: CriteriaKind,
  context: CompletionContext,
  insideQuotedToken: boolean,
): readonly BsonConstructorSuggestion[] {
  return kind === 'filter' && context.kind === 'document-value' && !insideQuotedToken
    ? bsonConstructorSuggestions
    : [];
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
