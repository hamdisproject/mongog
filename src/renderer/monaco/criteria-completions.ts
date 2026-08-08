import type { SemanticSuggestion } from '../../features/script-analysis/index.js';

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

export const bsonConstructorSuggestions: readonly BsonConstructorSuggestion[] = [
  { label: 'ObjectId', insertText: 'ObjectId("${1:507f1f77bcf86cd799439011}")', detail: 'BSON ObjectId' },
  { label: 'ISODate', insertText: 'ISODate("${1:2026-01-01T00:00:00.000Z}")', detail: 'BSON Date' },
  { label: 'Int32', insertText: 'Int32(${1:42})', detail: 'BSON 32-bit integer' },
  { label: 'NumberInt', insertText: 'NumberInt(${1:42})', detail: 'mongosh alias for Int32' },
  { label: 'Long', insertText: 'Long("${1:9223372036854775807}")', detail: 'BSON 64-bit integer' },
  { label: 'NumberLong', insertText: 'NumberLong("${1:9223372036854775807}")', detail: 'mongosh alias for Long' },
  { label: 'Double', insertText: 'Double(${1:3.14})', detail: 'BSON double' },
  { label: 'Decimal128', insertText: 'Decimal128("${1:125.50}")', detail: 'BSON Decimal128' },
  { label: 'NumberDecimal', insertText: 'NumberDecimal("${1:125.50}")', detail: 'mongosh alias for Decimal128' },
  { label: 'BinData', insertText: 'BinData(${1:0}, "${2:AQID}")', detail: 'BSON binary data' },
  { label: 'UUID', insertText: 'UUID("${1:00112233-4455-6677-8899-aabbccddeeff}")', detail: 'BSON UUID' },
  { label: 'BSONRegExp', insertText: 'BSONRegExp("${1:^value}", "${2:i}")', detail: 'BSON regular expression' },
  { label: 'Timestamp', insertText: 'Timestamp({ t: ${1:1700000000}, i: ${2:1} })', detail: 'BSON timestamp' },
  { label: 'MinKey', insertText: 'MinKey()', detail: 'BSON minimum key' },
  { label: 'MaxKey', insertText: 'MaxKey()', detail: 'BSON maximum key' },
  { label: 'DBRef', insertText: 'DBRef("${1:collection}", ObjectId("${2:507f1f77bcf86cd799439011}"))', detail: 'BSON database reference' },
  { label: 'Code', insertText: 'Code("${1:return value}")', detail: 'BSON code value' },
  { label: 'BSONSymbol', insertText: 'BSONSymbol("${1:value}")', detail: 'BSON symbol' },
] as const;

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
