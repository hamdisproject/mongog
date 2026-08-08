export type BsonSyntaxTokenKind =
  | 'plain'
  | 'property'
  | 'string'
  | 'escape'
  | 'number'
  | 'constructor'
  | 'keyword'
  | 'operator'
  | 'delimiter';

export interface BsonSyntaxToken {
  kind: BsonSyntaxTokenKind;
  text: string;
}

const BSON_CONSTRUCTORS = new Set([
  'ObjectId', 'ISODate', 'Date', 'Int32', 'NumberInt', 'Long', 'NumberLong',
  'Double', 'Decimal128', 'NumberDecimal', 'BinData', 'UUID', 'BSONRegExp',
  'Timestamp', 'MinKey', 'MaxKey', 'DBRef', 'Code', 'BSONSymbol',
]);

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const DELIMITERS = new Set(['{', '}', '[', ']', '(', ')', ',', ':']);
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*/;

/**
 * Tokenize already-formatted BSON display text. This is deliberately a small,
 * non-executing scanner: it never parses HTML or evaluates source text.
 */
export function tokenizeBsonSyntax(source: string): BsonSyntaxToken[] {
  const tokens: BsonSyntaxToken[] = [];
  let offset = 0;

  while (offset < source.length) {
    const character = source[offset]!;

    if (character === '"' || character === "'") {
      const stringEnd = findStringEnd(source, offset, character);
      const property = nextNonWhitespace(source, stringEnd) === ':';
      const propertyText = source.slice(offset, stringEnd);
      const kind: BsonSyntaxTokenKind = property
        ? unquote(propertyText).startsWith('$') ? 'operator' : 'property'
        : 'string';
      pushStringTokens(tokens, propertyText, kind);
      offset = stringEnd;
      continue;
    }

    if (DELIMITERS.has(character)) {
      pushToken(tokens, 'delimiter', character);
      offset += 1;
      continue;
    }

    const remainder = source.slice(offset);
    const numberMatch = remainder.match(NUMBER_PATTERN);
    if (numberMatch) {
      pushToken(tokens, 'number', numberMatch[0]);
      offset += numberMatch[0].length;
      continue;
    }

    const identifierMatch = remainder.match(IDENTIFIER_PATTERN);
    if (identifierMatch) {
      const identifier = identifierMatch[0];
      const afterIdentifier = offset + identifier.length;
      const next = nextNonWhitespace(source, afterIdentifier);
      const kind: BsonSyntaxTokenKind = next === ':'
        ? identifier.startsWith('$') ? 'operator' : 'property'
        : identifier.startsWith('$')
          ? 'operator'
          : BSON_CONSTRUCTORS.has(identifier) && next === '('
            ? 'constructor'
            : KEYWORDS.has(identifier)
              ? 'keyword'
              : 'plain';
      pushToken(tokens, kind, identifier);
      offset = afterIdentifier;
      continue;
    }

    pushToken(tokens, 'plain', character);
    offset += 1;
  }

  return tokens;
}

function findStringEnd(source: string, start: number, quote: string): number {
  let offset = start + 1;
  while (offset < source.length) {
    if (source[offset] === '\\') {
      offset = Math.min(source.length, offset + 2);
      continue;
    }
    if (source[offset] === quote) return offset + 1;
    offset += 1;
  }
  return source.length;
}

function nextNonWhitespace(source: string, start: number): string | undefined {
  for (let offset = start; offset < source.length; offset += 1) {
    if (!/\s/u.test(source[offset]!)) return source[offset];
  }
  return undefined;
}

function unquote(source: string): string {
  return source.length >= 2 ? source.slice(1, source.endsWith(source[0]!) ? -1 : undefined) : source;
}

function pushStringTokens(
  tokens: BsonSyntaxToken[],
  source: string,
  baseKind: Extract<BsonSyntaxTokenKind, 'property' | 'operator' | 'string'>,
): void {
  let chunkStart = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== '\\') continue;
    if (offset > chunkStart) pushToken(tokens, baseKind, source.slice(chunkStart, offset));
    const escapeEnd = Math.min(source.length, offset + 2);
    pushToken(tokens, 'escape', source.slice(offset, escapeEnd));
    offset = escapeEnd - 1;
    chunkStart = escapeEnd;
  }
  if (chunkStart < source.length) pushToken(tokens, baseKind, source.slice(chunkStart));
}

function pushToken(tokens: BsonSyntaxToken[], kind: BsonSyntaxTokenKind, text: string): void {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind && kind !== 'escape') {
    previous.text += text;
    return;
  }
  tokens.push({ kind, text });
}
