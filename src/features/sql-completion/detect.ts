/**
 * SQL completion context detection (PURE: no io, no stores, no driver).
 *
 * The SQL in the editor is usually incomplete, so a real parser (which needs
 * whole valid statements) cannot run at the cursor. Instead this module uses
 * a comment/string-aware tokenizer plus clause-keyword heuristics — the same
 * trade-off NoSQLBooster/Studio 3T make for their SQL boxes: contexts may be
 * approximate, but suggestions must never block typing.
 */
import {
  SQL_AGGREGATE_FUNCTIONS,
  SQL_EXPRESSION_FUNCTIONS,
  SQL_SCALAR_FUNCTIONS,
} from '../sql-translator/index.js';

export interface SqlScopeTable {
  table: string;
  alias: string;
  db: string | null;
}

export type SqlCompletionKind = 'table' | 'field' | 'qualified' | 'keyword';

export interface SqlCompletionContext {
  kind: SqlCompletionKind;
  /** Tables in scope, in order of appearance (FROM, then JOINs). */
  tables: SqlScopeTable[];
  /** Dotted identifiers before the cursor's dot (only for 'qualified'). */
  qualifierChain: string[];
}

type TokenType = 'word' | 'string' | 'quoted' | 'number' | 'symbol';

interface SqlToken {
  type: TokenType;
  value: string;
}

const TABLE_CLAUSES = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'DELETE']);
const FIELD_CLAUSES = new Set([
  'SELECT', 'WHERE', 'ON', 'SET', 'BY', 'HAVING', 'AND', 'OR', 'NOT', 'DISTINCT',
]);
const KEYWORD_CLAUSES = new Set(['AS', 'LIMIT', 'OFFSET', 'VALUES', 'ASC', 'DESC', 'UNION']);
const JOIN_MODIFIERS = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER']);
const EXTRA_RESERVED = new Set([
  'ORDER', 'GROUP', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
  'LIKE', 'IN', 'BETWEEN', 'IS', 'NULL', 'USING', 'ON',
]);

const RESERVED_WORDS: ReadonlySet<string> = new Set([
  ...TABLE_CLAUSES,
  ...FIELD_CLAUSES,
  ...KEYWORD_CLAUSES,
  ...JOIN_MODIFIERS,
  ...EXTRA_RESERVED,
]);

const FUNCTION_NAMES: ReadonlySet<string> = new Set([
  ...SQL_AGGREGATE_FUNCTIONS,
  ...SQL_SCALAR_FUNCTIONS,
  ...SQL_EXPRESSION_FUNCTIONS,
]);

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Quote an identifier for SQL output. Bare identifiers stay bare; anything
 * else (spaces, dots, leading digits, reserved words) gets MySQL backticks,
 * which node-sql-parser resolves to column_refs (verified: double quotes
 * parse as string literals in value positions).
 */
export function quoteSqlIdentifier(name: string): string {
  const upper = name.toUpperCase();
  if (BARE_IDENTIFIER.test(name) && !RESERVED_WORDS.has(upper) && !FUNCTION_NAMES.has(upper)) {
    return name;
  }
  return `\`${name.replace(/`/g, '``')}\``;
}

/**
 * Quote a sampled field path for SQL output. Dotted paths are quoted as ONE
 * identifier (`` `address.city` ``): an unquoted dot means `table.column` in
 * SQL and would resolve to the wrong table. Verified against node-sql-parser.
 */
export function quoteSqlPath(path: string): string {
  if (!path.includes('.')) return quoteSqlIdentifier(path);
  return `\`${path.replace(/`/g, '``')}\``;
}

/** Detect what kind of completions apply at the cursor offset. */
export function detectSqlCompletionContext(text: string, offset: number): SqlCompletionContext {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const head = text.slice(0, safeOffset);
  const tokens = tokenize(head);
  const statement = statementTokens(tokens);
  const tables = extractScope(statement);

  if (head.replace(/\s+$/, '').endsWith('.')) {
    const chain = qualifierChainBeforeDot(statement);
    if (chain.length > 0) return { kind: 'qualified', tables, qualifierChain: chain };
    return { kind: 'keyword', tables, qualifierChain: [] };
  }

  for (let index = statement.length - 1; index >= 0; index--) {
    const token = statement[index]!;
    if (token.type !== 'word') continue;
    const upper = token.value.toUpperCase();
    if (TABLE_CLAUSES.has(upper)) return { kind: 'table', tables, qualifierChain: [] };
    if (JOIN_MODIFIERS.has(upper)) return { kind: 'keyword', tables, qualifierChain: [] };
    if (FIELD_CLAUSES.has(upper)) return { kind: 'field', tables, qualifierChain: [] };
    if (KEYWORD_CLAUSES.has(upper)) return { kind: 'keyword', tables, qualifierChain: [] };
  }
  return { kind: tables.length > 0 ? 'field' : 'keyword', tables, qualifierChain: [] };
}

/** Walk backwards over `ident(.ident)*` directly before the trailing dot. */
function qualifierChainBeforeDot(statement: SqlToken[]): string[] {
  const chain: string[] = [];
  let index = statement.length - 1;
  if (index < 0 || statement[index]!.type !== 'symbol') return chain;
  index -= 1;
  while (index >= 0) {
    const token = statement[index]!;
    if (token.type !== 'word' && token.type !== 'quoted') break;
    chain.unshift(token.value);
    if (index - 1 < 0 || statement[index - 1]!.value !== '.') break;
    index -= 2;
  }
  return chain;
}

/** Tokens after the last top-level semicolon (the statement being edited). */
function statementTokens(tokens: SqlToken[]): SqlToken[] {
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.type === 'symbol' && tokens[index]!.value === ';') start = index + 1;
  }
  return tokens.slice(start);
}

function extractScope(statement: SqlToken[]): SqlScopeTable[] {
  const tables: SqlScopeTable[] = [];
  let index = 0;
  while (index < statement.length) {
    const token = statement[index]!;
    if (token.type === 'word' && TABLE_CLAUSES.has(token.value.toUpperCase())) {
      const fromClause = token.value.toUpperCase() === 'FROM';
      for (;;) {
        index += 1;
        const parsed = parseTableRef(statement, index);
        if (!parsed) break;
        tables.push(parsed.ref);
        index = parsed.next;
        if (!fromClause) break;
        if (statement[index]?.type === 'symbol' && statement[index]?.value === ',') continue;
        break;
      }
      continue;
    }
    index += 1;
  }
  return tables;
}

function parseTableRef(
  statement: SqlToken[],
  index: number,
): { ref: SqlScopeTable; next: number } | null {
  const first = statement[index];
  if (!first || (first.type !== 'word' && first.type !== 'quoted')) return null;
  let table = first.value;
  let db: string | null = null;
  let next = index + 1;
  const dot = statement[next];
  const second = statement[next + 1];
  if (dot?.type === 'symbol' && dot.value === '.' && second &&
    (second.type === 'word' || second.type === 'quoted')) {
    db = table;
    table = second.value;
    next += 2;
  }
  let alias = table;
  const asToken = statement[next];
  if (asToken?.type === 'word' && asToken.value.toUpperCase() === 'AS') {
    const aliasToken = statement[next + 1];
    if (aliasToken && (aliasToken.type === 'word' || aliasToken.type === 'quoted')) {
      alias = aliasToken.value;
      next += 2;
    }
  } else if (
    asToken && (asToken.type === 'word' || asToken.type === 'quoted') &&
    (asToken.type !== 'word' || !RESERVED_WORDS.has(asToken.value.toUpperCase()))
  ) {
    alias = asToken.value;
    next += 1;
  }
  return { ref: { table, alias, db }, next };
}

/**
 * Comment/string-aware tokenizer. String contents and comments never surface
 * as tokens, so `;`, `--` or keywords inside literals cannot disturb scope
 * detection. Best-effort on truncated input (unterminated literal at the end
 * becomes a partial token).
 */
function tokenize(head: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < head.length) {
    const char = head[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '-' && head[index + 1] === '-' &&
      (index + 2 >= head.length || /[\s;)]/.test(head[index + 2]!))) {
      const newline = head.indexOf('\n', index + 2);
      index = newline < 0 ? head.length : newline + 1;
      continue;
    }
    if (char === '/' && head[index + 1] === '*') {
      const end = head.indexOf('*/', index + 2);
      index = end < 0 ? head.length : end + 2;
      continue;
    }
    if (char === "'") {
      tokens.push({ type: 'string', value: readQuoted(head, index, "'") });
      index = skipQuoted(head, index, "'");
      continue;
    }
    if (char === '`' || char === '"') {
      tokens.push({ type: 'quoted', value: readQuoted(head, index, char) });
      index = skipQuoted(head, index, char);
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(head.slice(index));
      tokens.push({ type: 'number', value: match![0] });
      index += match![0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(head.slice(index));
      tokens.push({ type: 'word', value: match![0] });
      index += match![0].length;
      continue;
    }
    tokens.push({ type: 'symbol', value: char });
    index += 1;
  }
  return tokens;
}

function skipQuoted(head: string, index: number, quote: string): number {
  let cursor = index + 1;
  while (cursor < head.length) {
    if (head[cursor] === quote) {
      if (head[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    if (quote === "'" && head[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    cursor += 1;
  }
  return cursor;
}

function readQuoted(head: string, index: number, quote: string): string {
  const end = skipQuoted(head, index, quote);
  const inner = head.slice(index + 1, head[end - 1] === quote ? end - 1 : end);
  return inner.split(quote + quote).join(quote);
}
