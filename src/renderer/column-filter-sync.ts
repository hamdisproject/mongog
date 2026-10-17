import { parseDocumentClauses, type DocumentClause } from '../features/script-analysis/index.js';
import {
  compileColumnFilterClause,
  type ColumnFilterMap,
  type CompiledFieldFilter,
} from './collection-column-filter.js';

/**
 * Two-way sync between the Documents Filter editor and the table-column
 * inputs. The Filter text is the source of truth; columns are a view of the
 * top-level clauses that a column input can reproduce EXACTLY (verified by
 * compiling the candidate and comparing canonical EJSON). Everything else
 * stays in the Filter, verbatim, when a column edit rebuilds it.
 */

/** Canonical clause JSONs each column produced or was matched to. */
export type OwnedColumnClauses = Record<string, string[]>;

export interface DerivedColumnFilters {
  columns: ColumnFilterMap;
  owned: OwnedColumnClauses;
}

export type RebuiltFilter =
  | { kind: 'ok'; filter: string; owned: OwnedColumnClauses }
  | { kind: 'column-errors'; errors: Record<string, string> }
  | { kind: 'invalid-filter'; message: string };

const COMPARISON_SYMBOLS: Record<string, string> = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
};

/** Column inputs for the Filter's clauses, or null while the Filter is invalid. */
export function deriveColumnFilters(filterSource: string): DerivedColumnFilters | null {
  const clauses = parseClauses(filterSource);
  if (!clauses) return null;
  const columns: ColumnFilterMap = {};
  const owned: OwnedColumnClauses = {};
  for (const clause of clauses) {
    if (clause.key.startsWith('$') || clause.key.includes('.') || Object.hasOwn(columns, clause.key)) continue;
    const text = columnTextFor(clause);
    if (text === null) continue;
    columns[clause.key] = text;
    owned[clause.key] = [clause.json];
  }
  return { columns, owned };
}

/** Replace the clauses columns own with the current column inputs; keep the rest verbatim. */
export function rebuildFilterFromColumns(
  filterSource: string,
  owned: OwnedColumnClauses,
  columns: ColumnFilterMap,
): RebuiltFilter {
  const clauses = parseClauses(filterSource);
  if (!clauses) {
    return { kind: 'invalid-filter', message: 'Filter is invalid; fix it before using column filters.' };
  }

  const compiled: Array<CompiledFieldFilter & { column: string; json: string[] }> = [];
  const errors: Record<string, string> = {};
  for (const [column, rawSource] of Object.entries(columns)) {
    if (!rawSource.trim()) continue;
    try {
      const clause = compileColumnFilterClause(column, rawSource);
      compiled.push({ ...clause, column, json: parseDocumentClauses(clause.clause).map((piece) => piece.json) });
    } catch (error) {
      errors[column] = error instanceof Error ? error.message : String(error);
    }
  }
  if (Object.keys(errors).length > 0) return { kind: 'column-errors', errors };

  const remaining = new Map<string, number>();
  for (const json of Object.values(owned).flat()) remaining.set(json, (remaining.get(json) ?? 0) + 1);
  const residual = clauses.filter((clause) => {
    const count = remaining.get(clause.json) ?? 0;
    if (count === 0) return true;
    remaining.set(clause.json, count - 1);
    return false;
  });

  return {
    kind: 'ok',
    filter: renderFilter(residual, compiled),
    owned: Object.fromEntries(compiled.map((clause) => [clause.column, clause.json])),
  };
}

function parseClauses(filterSource: string): DocumentClause[] | null {
  try {
    return parseDocumentClauses(filterSource.trim() || '{}', 'Filter');
  } catch {
    return null;
  }
}

/** Same layout as compileColumnFilters, with residual clauses kept as written. */
function renderFilter(
  residual: DocumentClause[],
  compiled: Array<CompiledFieldFilter & { column: string }>,
): string {
  if (residual.length + compiled.length === 0) return '{}';

  const keys = [...residual.map((clause) => clause.key), ...compiled.map((clause) => clause.column)];
  if (compiled.every((clause) => !clause.logical) && new Set(keys).size === keys.length) {
    const properties = [...residual.map((clause) => clause.propertySource), ...compiled.map((clause) => clause.property)];
    return `{\n${properties.map((property) => `  ${property}`).join(',\n')}\n}`;
  }

  const items = [...residual.map((clause) => `{ ${clause.propertySource} }`), ...compiled.map((clause) => clause.clause)];
  return items.length === 1
    ? items[0]!
    : `{\n  "$and": [\n${items.map((item) => `    ${item}`).join(',\n')}\n  ]\n}`;
}

/** First readable (or verbatim) column text that compiles back to exactly this clause. */
function columnTextFor(clause: DocumentClause): string | null {
  const value = (JSON.parse(clause.json) as Record<string, unknown>)[clause.key];
  const candidates = new Set([...readableCandidates(value), clause.valueSource.trim()]);
  for (const candidate of candidates) {
    if (candidate && reproducesClause(clause, candidate)) return candidate;
  }
  return null;
}

function reproducesClause(clause: DocumentClause, text: string): boolean {
  try {
    const compiled = parseDocumentClauses(compileColumnFilterClause(clause.key, text).clause);
    return compiled.length === 1 && compiled[0]!.json === clause.json;
  } catch {
    return false;
  }
}

function readableCandidates(value: unknown): string[] {
  const scalar = scalarCandidates(value);
  if (scalar.length > 0 || !isRecord(value)) return scalar;

  const entries = Object.entries(value);
  if (entries.length === 1) {
    const [operator, operand] = entries[0]!;
    if (operator === '$ne') return scalarCandidates(operand).map((text) => `<> ${text}`);
    if (COMPARISON_SYMBOLS[operator]) {
      return scalarCandidates(operand).map((text) => `${COMPARISON_SYMBOLS[operator]} ${text}`);
    }
    if (operator === '$exists' && operand === true) return ['*'];
    if ((operator === '$in' || operator === '$nin') && Array.isArray(operand) && operand.length === 1) {
      const prefix = operator === '$in' ? 'has' : '!has';
      return scalarCandidates(operand[0]).map((text) => `${prefix} ${text}`);
    }
    if (operator === '$size' && typeof operand === 'number') return [`len = ${operand}`];
    return [];
  }

  if (entries.length === 2) {
    if (typeof value.$regex === 'string' && value.$options === 'i') {
      const wildcard = wildcardText(value.$regex);
      return wildcard === null ? [] : [wildcard];
    }
    const [[firstOperator, first], [secondOperator, second]] = entries as [[string, unknown], [string, unknown]];
    if (
      COMPARISON_SYMBOLS[firstOperator] && COMPARISON_SYMBOLS[secondOperator] &&
      typeof first === 'number' && typeof second === 'number'
    ) {
      return [
        ...(firstOperator === '$gte' && secondOperator === '$lte' ? [`${first}..${second}`] : []),
        `${COMPARISON_SYMBOLS[firstOperator]} ${first} ${COMPARISON_SYMBOLS[secondOperator]} ${second}`,
      ];
    }
  }
  return [];
}

function scalarCandidates(value: unknown): string[] {
  if (typeof value === 'string') return [value, JSON.stringify(value)];
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [String(value)];
  return [];
}

/** Reverse of the column wildcard compiler: ^a.*b$ → a*b. */
function wildcardText(pattern: string): string | null {
  let body = pattern;
  const anchoredStart = body.startsWith('^');
  if (anchoredStart) body = body.slice(1);
  const anchoredEnd = body.endsWith('$') && !body.endsWith('\\$');
  if (anchoredEnd) body = body.slice(0, -1);
  let text = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === '\\' && index + 1 < body.length) {
      text += body[index + 1];
      index += 1;
    } else if (character === '.' && body[index + 1] === '*') {
      text += '*';
      index += 1;
    } else if (/[.*+?^${}()|[\]]/.test(character)) {
      return null;
    } else {
      text += character;
    }
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
