/**
 * SQL suggestion builder (PURE: no io, no stores — the Monaco provider feeds
 * it collection names, database names and sampled schemas).
 *
 * Field detail/sort conventions mirror `script-analysis/completions.ts` so
 * both editors feel alike: `<types> · <presence>%`, presence-first ordering.
 */
import type { SchemaFieldInfo } from '../../shared/domain/index.js';
import {
  SQL_AGGREGATE_FUNCTIONS,
  SQL_EXPRESSION_FUNCTIONS,
  SQL_SCALAR_FUNCTIONS,
} from '../sql-translator/index.js';
import { quoteSqlIdentifier, quoteSqlPath, type SqlCompletionContext } from './detect.js';

export type SqlSuggestionKind = 'table' | 'database' | 'field' | 'alias' | 'keyword' | 'function';

export interface SqlSuggestion {
  label: string;
  insertText: string;
  kind: SqlSuggestionKind;
  detail: string;
  documentation?: string;
  sortText: string;
  snippet?: boolean;
}

export interface SqlSchemaInput {
  table: string;
  alias: string;
  db: string | null;
  fields: SchemaFieldInfo[];
}

export interface SqlSuggestionInput {
  collectionNames: string[];
  databaseNames: string[];
  schemas: SqlSchemaInput[];
}

const MAX_FIELD_SUGGESTIONS = 300;

interface ClauseKeyword {
  label: string;
  insertText: string;
  snippet?: boolean;
}

const CLAUSE_KEYWORDS: readonly ClauseKeyword[] = [
  { label: 'SELECT', insertText: 'SELECT ' },
  { label: 'DISTINCT', insertText: 'DISTINCT ' },
  { label: 'FROM', insertText: 'FROM ' },
  { label: 'WHERE', insertText: 'WHERE ' },
  { label: 'AND', insertText: 'AND ' },
  { label: 'OR', insertText: 'OR ' },
  { label: 'NOT', insertText: 'NOT ' },
  { label: 'ORDER BY', insertText: 'ORDER BY ${1}', snippet: true },
  { label: 'GROUP BY', insertText: 'GROUP BY ${1}', snippet: true },
  { label: 'HAVING', insertText: 'HAVING ' },
  { label: 'LIMIT', insertText: 'LIMIT ' },
  { label: 'OFFSET', insertText: 'OFFSET ' },
  { label: 'AS', insertText: 'AS ' },
  { label: 'ASC', insertText: 'ASC' },
  { label: 'DESC', insertText: 'DESC' },
  { label: 'ON', insertText: 'ON ' },
  { label: 'INNER JOIN', insertText: 'INNER JOIN ${1}', snippet: true },
  { label: 'LEFT JOIN', insertText: 'LEFT JOIN ${1}', snippet: true },
  { label: 'INSERT INTO', insertText: 'INSERT INTO ' },
  { label: 'VALUES', insertText: 'VALUES (${1})', snippet: true },
  { label: 'UPDATE', insertText: 'UPDATE ' },
  { label: 'SET', insertText: 'SET ' },
  { label: 'DELETE', insertText: 'DELETE ' },
  { label: 'LIKE', insertText: 'LIKE ' },
  { label: 'IN', insertText: 'IN (${1})', snippet: true },
  { label: 'BETWEEN', insertText: 'BETWEEN ${1} AND ${2}', snippet: true },
  { label: 'IS NULL', insertText: 'IS NULL' },
  { label: 'IS NOT NULL', insertText: 'IS NOT NULL' },
  { label: 'TRUE', insertText: 'TRUE' },
  { label: 'FALSE', insertText: 'FALSE' },
  { label: 'NULL', insertText: 'NULL' },
];

const TABLE_CLAUSE_KEYWORDS: readonly ClauseKeyword[] = [
  { label: 'WHERE', insertText: 'WHERE ' },
  { label: 'GROUP BY', insertText: 'GROUP BY ${1}', snippet: true },
  { label: 'ORDER BY', insertText: 'ORDER BY ${1}', snippet: true },
  { label: 'LIMIT', insertText: 'LIMIT ' },
  { label: 'INNER JOIN', insertText: 'INNER JOIN ${1}', snippet: true },
  { label: 'LEFT JOIN', insertText: 'LEFT JOIN ${1}', snippet: true },
];

/** Collection-name suggestions (also reused for `db.|` qualified roots). */
export function collectionNameSuggestions(names: string[]): SqlSuggestion[] {
  return uniqueStrings(names).map((name) => ({
    label: name,
    insertText: quoteTableName(name),
    kind: 'table' as const,
    detail: 'collection',
    sortText: `a-${name}`,
  }));
}

/** Mirrors `sqlCollectionName`: double quotes parse as table refs. */
function quoteTableName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export function databaseNameSuggestions(names: string[]): SqlSuggestion[] {
  return uniqueStrings(names).map((name) => ({
    label: name,
    insertText: name,
    kind: 'database' as const,
    detail: 'database',
    sortText: `b-${name}`,
  }));
}

function keywordSuggestions(keywords: readonly ClauseKeyword[]): SqlSuggestion[] {
  return keywords.map((keyword) => ({
    label: keyword.label,
    insertText: keyword.insertText,
    kind: 'keyword' as const,
    detail: 'SQL keyword',
    sortText: `z-${keyword.label}`,
    ...(keyword.snippet ? { snippet: true as const } : {}),
  }));
}

function functionSuggestions(): SqlSuggestion[] {
  const suggestions: SqlSuggestion[] = [];
  for (const name of SQL_AGGREGATE_FUNCTIONS) {
    suggestions.push({
      label: name,
      insertText: name === 'COUNT' ? 'COUNT(${1:*})' : `${name}(\${1:field})`,
      kind: 'function',
      detail: 'aggregate function',
      documentation: `GROUP BY queries translate ${name} to a $group accumulator.`,
      sortText: `z-f-${name}`,
      snippet: true,
    });
  }
  for (const name of SQL_SCALAR_FUNCTIONS) {
    suggestions.push({
      label: name,
      insertText: `${name}(\${1:field})`,
      kind: 'function',
      detail: 'scalar function',
      sortText: `z-f-${name}`,
      snippet: true,
    });
  }
  for (const name of SQL_EXPRESSION_FUNCTIONS) {
    suggestions.push({
      label: name,
      insertText: `${name}(\${1:a}, \${2:b})`,
      kind: 'function',
      detail: 'expression function',
      sortText: `z-f-${name}`,
      snippet: true,
    });
  }
  return suggestions;
}

/** Build Monaco-ready (but Monaco-free) suggestions for a completion context. */
export function buildSqlSuggestions(
  context: SqlCompletionContext,
  input: SqlSuggestionInput,
): SqlSuggestion[] {
  switch (context.kind) {
    case 'table':
      return [
        ...collectionNameSuggestions(input.collectionNames),
        ...databaseNameSuggestions(input.databaseNames),
        ...keywordSuggestions(TABLE_CLAUSE_KEYWORDS),
      ];
    case 'field':
      return [
        ...aliasSuggestions(context, input.schemas),
        ...fieldSuggestions(input.schemas, null),
        ...keywordSuggestions(CLAUSE_KEYWORDS),
        ...functionSuggestions(),
      ];
    case 'qualified':
      return qualifiedSuggestions(context, input);
    case 'keyword':
      return [...keywordSuggestions(CLAUSE_KEYWORDS), ...functionSuggestions()];
  }
}

function aliasSuggestions(
  context: SqlCompletionContext,
  schemas: SqlSchemaInput[],
): SqlSuggestion[] {
  const byAlias = new Map<string, SqlSchemaInput>();
  for (const table of context.tables) {
    const schema = schemas.find((candidate) =>
      candidate.alias === table.alias || candidate.table === table.table,
    );
    if (schema && schema.alias !== schema.table) byAlias.set(schema.alias, schema);
    else if (!schema && table.alias !== table.table) {
      byAlias.set(table.alias, { table: table.table, alias: table.alias, db: table.db, fields: [] });
    }
  }
  return [...byAlias.entries()].map(([alias, schema]) => ({
    label: alias,
    insertText: quoteSqlIdentifier(alias),
    kind: 'alias' as const,
    detail: `alias for ${schema.table}`,
    documentation: `Type "${alias}." to complete fields of ${schema.table}.`,
    sortText: `!-alias-${alias}`,
  }));
}

interface ResolvedField {
  path: string;
  types: string;
  presence: number;
  exampleEjson?: string;
  tables: string[];
}

/** `items[].sku` array-element paths are addressable in Mongo as `items.sku`. */
export function normalizeSampledPath(path: string): string {
  return path.replaceAll('[]', '');
}

function collectFields(schemas: SqlSchemaInput[]): ResolvedField[] {
  const merged = new Map<string, ResolvedField>();
  for (const schema of schemas) {
    for (const field of schema.fields) {
      const path = normalizeSampledPath(field.path);
      if (!path) continue;
      const existing = merged.get(path);
      const types = field.types.slice(0, 3).map((type) => type.bsonType).join(' | ') || 'unknown';
      if (existing) {
        if (!existing.tables.includes(schema.alias)) existing.tables.push(schema.alias);
        continue;
      }
      merged.set(path, {
        path,
        types,
        presence: field.presence,
        ...(field.exampleEjson !== undefined ? { exampleEjson: field.exampleEjson } : {}),
        tables: [schema.alias],
      });
    }
  }
  return [...merged.values()];
}

function fieldSuggestions(schemas: SqlSchemaInput[], prefix: string | null): SqlSuggestion[] {
  const suggestions: SqlSuggestion[] = [];
  for (const field of collectFields(schemas)) {
    if (prefix !== null) {
      if (field.path !== prefix && !field.path.startsWith(`${prefix}.`)) continue;
    }
    suggestions.push({
      label: field.path,
      insertText: quoteSqlPath(field.path),
      kind: 'field',
      detail: `${field.types} · ${(field.presence * 100).toFixed(0)}% sampled · ${field.tables.join(', ')}`,
      documentation: field.exampleEjson
        ? `Inferred from sampled field ${field.path}. Example: ${field.exampleEjson}`
        : `Inferred from sampled field ${field.path}.`,
      sortText: `a${Math.round((1 - field.presence) * 1000).toString().padStart(4, '0')}-${field.path}`,
    });
    if (suggestions.length >= MAX_FIELD_SUGGESTIONS) break;
  }
  return suggestions.sort((left, right) =>
    left.sortText.localeCompare(right.sortText),
  );
}

/**
 * Immediate children of a dotted prefix (`address.` -> `city`, `zip`).
 * Mirrors `relativeFieldPath` from script-analysis: only one level is shown
 * so typing `.` drills deeper step by step, including inside nested docs.
 */
function childSuggestions(schemas: SqlSchemaInput[], prefix: string): SqlSuggestion[] {
  const seen = new Map<string, ResolvedField>();
  for (const field of collectFields(schemas)) {
    // Empty prefix (`alias.`) lists top-level segments; otherwise the next
    // segment below `prefix`.
    const rest = prefix === ''
      ? field.path
      : field.path === prefix
        ? ''
        : field.path.startsWith(`${prefix}.`)
          ? field.path.slice(prefix.length + 1)
          : null;
    if (!rest) continue;
    const dot = rest.indexOf('.');
    const child = dot < 0 ? rest : rest.slice(0, dot);
    if (!child || seen.has(child)) continue;
    seen.set(child, field);
  }
  return [...seen.entries()].map(([child, field]) => ({
    label: quoteSqlIdentifier(child),
    insertText: quoteSqlIdentifier(child),
    kind: 'field' as const,
    detail: `${field.types} · ${(field.presence * 100).toFixed(0)}% sampled · ${field.tables.join(', ')}`,
    documentation: `Nested field ${prefix}.${child} (inferred from sampled documents).`,
    sortText: `a${Math.round((1 - field.presence) * 1000).toString().padStart(4, '0')}-${child}`,
  })).sort((left, right) => left.sortText.localeCompare(right.sortText));
}

function qualifiedSuggestions(
  context: SqlCompletionContext,
  input: SqlSuggestionInput,
): SqlSuggestion[] {
  const [root, ...rest] = context.qualifierChain;
  if (!root) return [];
  const schema = input.schemas.find((candidate) =>
    candidate.alias === root || candidate.table === root,
  );
  if (schema) {
    // `alias.` -> top-level fields; `alias.a.b.` -> children of a.b.
    return childSuggestions([schema], rest.join('.'));
  }
  // Unresolved root (e.g. a bare `address.`): complete children across scope.
  const prefix = context.qualifierChain.join('.');
  const across = childSuggestions(input.schemas, prefix);
  if (across.length > 0) return across;
  // Last resort: full paths sharing the prefix (lets typing continue).
  return fieldSuggestions(input.schemas, prefix);
}

function uniqueStrings(names: string[]): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}
