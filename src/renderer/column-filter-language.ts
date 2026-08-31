import type { SchemaFieldInfo } from '../shared/domain/index.js';
import { tokenizeBsonSyntax, type BsonSyntaxTokenKind } from './bson-syntax.js';
import { compileColumnFilters } from './collection-column-filter.js';

export interface ColumnFilterToken {
  kind: BsonSyntaxTokenKind | 'regexp';
  text: string;
  start: number;
  end: number;
}

export interface ColumnFilterSuggestion {
  label: string;
  detail: string;
  kind: 'field' | 'operator';
  start: number;
  end: number;
  insertText: string;
}

interface Selector {
  array: boolean;
  fieldStart: number;
  fieldEnd: number;
  close: number;
  end: number;
}

const COMPARISONS = ['=', '>', '>=', '<', '<=', '<>', '!='];
const LOGICAL = ['AND', 'OR', '&&', '||'];
const OPERATORS = [...COMPARISONS, 'has', '!has', 'len'];
const DETAILS: Record<string, string> = {
  '=': 'Equals', '>': 'Greater than', '>=': 'Greater than or equal',
  '<': 'Less than', '<=': 'Less than or equal', '<>': 'Not equal', '!=': 'Not equal',
  has: 'Array contains a value or wildcard', '!has': 'Array excludes a value or wildcard',
  len: 'Array length condition', AND: 'Match both conditions', OR: 'Match either condition',
  '&&': 'Match both conditions', '||': 'Match either condition',
};

/** Advisory lexer only. compileColumnFilters remains the authority on validity. */
export function tokenizeColumnFilter(source: string): ColumnFilterToken[] {
  const tokens: ColumnFilterToken[] = [];
  const push = (kind: ColumnFilterToken['kind'], start: number, end: number) => {
    if (end > start) tokens.push({ kind, text: source.slice(start, end), start, end });
  };
  let offset = 0;
  let conditionStart = true;
  let selectorPrefix = false;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      push('plain', offset, offset + whitespace[0].length);
      offset += whitespace[0].length;
      continue;
    }
    const selector = conditionStart ? readSelector(source, offset) : null;
    if (selector) {
      push('delimiter', offset, selector.fieldStart);
      push('property', selector.fieldStart, selector.fieldEnd);
      push('delimiter', selector.fieldEnd, selector.end);
      offset = selector.end;
      selectorPrefix = true;
      continue;
    }
    if (selectorPrefix && source[offset] === ':') {
      push('delimiter', offset, ++offset);
      selectorPrefix = false;
      continue;
    }
    const logical = logicalAt(source, offset);
    if (logical) {
      push('operator', offset, offset + logical.length);
      offset += logical.length;
      conditionStart = true;
      selectorPrefix = false;
      continue;
    }
    const keyword = conditionStart ? /^(!?has|len)(?=\s|$)/i.exec(rest) : null;
    if (keyword) {
      push('keyword', offset, offset + keyword[0].length);
      offset += keyword[0].length;
      conditionStart = false;
      continue;
    }
    if (source[offset] === '"' || source[offset] === "'" || source[offset] === '`') {
      const end = quotedEnd(source, offset);
      push('string', offset, end);
      offset = end;
      conditionStart = false;
      continue;
    }
    if (source[offset] === '/') {
      const end = regexEnd(source, offset);
      push('regexp', offset, end);
      offset = end;
      conditionStart = false;
      continue;
    }
    // Literal documents/arrays and constructor arguments cannot contain DSL operators.
    if ('{[('.includes(source[offset]!)) {
      const end = balancedEnd(source, offset);
      for (const token of tokenizeBsonSyntax(source.slice(offset, end))) {
        push(token.kind, offset, offset + token.text.length);
        offset += token.text.length;
      }
      conditionStart = false;
      continue;
    }
    const operator = /^(>=|<=|<>|!=|>|<|=|\.\.|\*+|!)/.exec(rest);
    if (operator) {
      push('operator', offset, offset + operator[0].length);
      offset += operator[0].length;
      conditionStart = false;
      continue;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\p{L}\p{N}_])/u.exec(rest);
    if (number) {
      push('number', offset, offset + number[0].length);
      offset += number[0].length;
      conditionStart = false;
      continue;
    }
    const word = /^[^\s{}\[\](),:'"`/<>!=*&|]+/u.exec(rest);
    if (word) {
      const end = offset + word[0].length;
      const bson = tokenizeBsonSyntax(source.slice(offset, end) + (source[end] === '(' ? '(' : ''));
      push(bson[0]?.kind === 'constructor' ? 'constructor'
        : /^(true|false|null)$/.test(word[0]) ? 'keyword' : 'string', offset, end);
      offset = end;
    } else {
      push('delimiter', offset, offset + 1);
      offset += 1;
    }
    conditionStart = false;
  }
  return tokens;
}

/** Completes syntax and schema paths, never sampled document values. */
export function completeColumnFilter(
  source: string,
  caret: number,
  column: string,
  fields: readonly SchemaFieldInfo[] = [],
  manual = false,
): ColumnFilterSuggestion[] {
  caret = Math.max(0, Math.min(source.length, caret));
  const tokens = tokenizeColumnFilter(source);
  let termStart = 0;
  for (const token of tokens) {
    if (token.end <= caret && token.kind === 'operator' && LOGICAL.includes(token.text.toUpperCase())) {
      termStart = token.end;
    }
  }
  let offset = skipWhitespace(source, termStart);
  let path = column;
  while (offset <= caret) {
    const selector = readSelector(source, offset);
    if (!selector) break;
    if (caret >= selector.fieldStart && caret <= selector.fieldEnd) {
      const prefix = decodeField(source.slice(selector.fieldStart, caret)).toLocaleLowerCase();
      const schemaPrefix = `${path}${selector.array ? '[]' : ''}.`;
      const candidates = new Map<string, SchemaFieldInfo>();
      for (const field of fields) {
        if (!field.path.startsWith(schemaPrefix)) continue;
        const name = field.path.slice(schemaPrefix.length);
        if (!name || name.includes('.') || name.includes('[]') || name.includes('\0') || name.startsWith('$')) continue;
        if (name.toLocaleLowerCase().startsWith(prefix)) candidates.set(name, field);
      }
      return [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 50)
        .map(([name, field]) => ({
          label: name,
          detail: `${field.types.map((type) => type.bsonType).join(' | ')} · inferred field`,
          kind: 'field', start: selector.fieldStart, end: selector.end,
          insertText: `${encodeField(name)}${selector.array ? '}]' : '}'}`,
        }));
    }
    if (selector.close < 0 || selector.end > caret) return [];
    path += `${selector.array ? '[]' : ''}.${decodeField(source.slice(selector.fieldStart, selector.fieldEnd))}`;
    offset = skipWhitespace(source, selector.end);
  }
  if (source[offset] === ':') offset = skipWhitespace(source, offset + 1);
  if (offset > caret) return [];
  let literalDepth = 0;
  for (const token of tokens) {
    if (token.start < offset || token.start >= caret || token.kind !== 'delimiter') continue;
    for (const ch of token.text.slice(0, caret - token.start)) {
      if ('{[('.includes(ch)) literalDepth += 1;
      else if ('}])'.includes(ch)) literalDepth -= 1;
    }
  }
  if (literalDepth > 0) return [];

  const before = source.slice(offset, caret);
  const operatorPrefix = /^\s*([!<>=\p{L}]*)$/u.exec(before);
  if (operatorPrefix) {
    const prefix = operatorPrefix[1]!;
    if (!prefix && !manual && !source.slice(termStart, offset).includes(':') && termStart === 0) return [];
    return operatorSuggestions(source, caret - prefix.length, caret, prefix, OPERATORS);
  }
  const lengthPrefix = /^len\s+([!<>=]*)$/i.exec(before);
  if (lengthPrefix) {
    const prefix = lengthPrefix[1]!;
    return operatorSuggestions(source, caret - prefix.length, caret, prefix, COMPARISONS);
  }
  // Only offer logical continuations while typing a keyword (or explicitly invoked).
  const logicalPrefix = /\s+([aAoO][aAnNdDrR]*|[&|]{1,2})$/.exec(before);
  const prefixStart = logicalPrefix ? caret - logicalPrefix[1]!.length : caret;
  const inLiteral = tokens.some((token) => token.start < prefixStart && token.end >= caret &&
    (token.kind === 'regexp' || token.kind === 'string') &&
    ['"', "'", '`', '/'].includes(token.text[0]!));
  if (inLiteral) return [];
  const validContinuation = (end: number) => {
    const condition = source.slice(termStart, end).trim();
    return condition.length > 0 && Object.keys(compileColumnFilters({ [column]: condition }).errors).length === 0;
  };
  if (logicalPrefix && validContinuation(prefixStart)) {
    return operatorSuggestions(source, prefixStart, caret, logicalPrefix[1]!, LOGICAL);
  }
  if (manual && /\s$/.test(before) && validContinuation(caret)) {
    return operatorSuggestions(source, caret, caret, '', LOGICAL);
  }
  return [];
}

function operatorSuggestions(source: string, start: number, caret: number, prefix: string, labels: string[]): ColumnFilterSuggestion[] {
  const suffix = /^[\p{L}!<>=&|]*/u.exec(source.slice(caret))![0];
  const end = caret + suffix.length;
  return labels.filter((label) => label.toLowerCase().startsWith(prefix.toLowerCase())).map((label) => ({
    label, detail: DETAILS[label]!, kind: 'operator', start, end,
    insertText: label + (/^\s/.test(source.slice(end)) ? '' : ' '),
  }));
}

function readSelector(source: string, start: number): Selector | null {
  const array = source.startsWith('[{', start);
  if (!array && source[start] !== '{') return null;
  const fieldStart = start + (array ? 2 : 1);
  let offset = fieldStart;
  while (offset < source.length) {
    const ch = source[offset];
    if (ch === '"' || ch === "'") {
      offset = quotedEnd(source, offset);
      continue;
    }
    if (ch === ':' || ch === '{' || ch === '[' || ch === '\n') return null;
    if (ch === '}') return {
      array, fieldStart, fieldEnd: offset, close: offset,
      end: offset + (array && source[offset + 1] === ']' ? 2 : 1),
    };
    offset += 1;
  }
  return { array, fieldStart, fieldEnd: source.length, close: -1, end: source.length };
}

function decodeField(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return trimmed;
  const body = trimmed.slice(1, trimmed.length > 1 && trimmed.endsWith(quote) ? -1 : undefined);
  return body.replace(/\\(?:u([\dA-Fa-f]{4})|(.))/g, (_, hex: string | undefined, escaped: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[escaped] ?? escaped));
}

function encodeField(name: string): string {
  return /^[_\p{ID_Start}][\p{ID_Continue}_]*$/u.test(name) ? name : JSON.stringify(name);
}

function skipWhitespace(source: string, start: number): number {
  while (start < source.length && /\s/.test(source[start]!)) start += 1;
  return start;
}

function logicalAt(source: string, offset: number): string | null {
  const symbol = /^(?:&&|\|\|)/.exec(source.slice(offset));
  if (symbol) return symbol[0];
  if (offset > 0 && !/\s/.test(source[offset - 1]!)) return null;
  return /^(?:AND|OR)(?=\s|$)/i.exec(source.slice(offset))?.[0] ?? null;
}

function quotedEnd(source: string, start: number): number {
  for (let offset = start + 1; offset < source.length; offset += 1) {
    if (source[offset] === '\\') offset += 1;
    else if (source[offset] === source[start]) return offset + 1;
  }
  return source.length;
}

function regexEnd(source: string, start: number): number {
  let inClass = false;
  for (let offset = start + 1; offset < source.length; offset += 1) {
    const ch = source[offset];
    if (ch === '\\') { offset += 1; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      return offset + 1 + (/^[a-z]*/i.exec(source.slice(offset + 1))?.[0].length ?? 0);
    }
  }
  return source.length;
}

function balancedEnd(source: string, start: number): number {
  let depth = 0;
  for (let offset = start; offset < source.length; offset += 1) {
    const ch = source[offset]!;
    if (ch === '"' || ch === "'" || ch === '`') offset = quotedEnd(source, offset) - 1;
    else if (ch === '/') offset = regexEnd(source, offset) - 1;
    else if ('{[('.includes(ch)) depth += 1;
    else if ('}])'.includes(ch) && --depth === 0) return offset + 1;
  }
  return source.length;
}
