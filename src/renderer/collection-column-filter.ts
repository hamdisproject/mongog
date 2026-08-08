import { parseDocumentExpression } from '../features/script-analysis/index.js';

export type ColumnFilterMap = Record<string, string>;

export interface CompiledColumnFilters {
  expression: string;
  errors: Record<string, string>;
}

export class ColumnFilterSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnFilterSyntaxError';
  }
}

const NUMBER_SOURCE = String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const NUMBER_PATTERN = new RegExp(`^${NUMBER_SOURCE}$`);
const RANGE_PATTERN = new RegExp(String.raw`^(${NUMBER_SOURCE})\s*\.\.\s*(${NUMBER_SOURCE})$`);
const COMPOUND_COMPARISON_PATTERN = new RegExp(
  String.raw`^(>=|>|<=|<)\s*(${NUMBER_SOURCE})\s+(>=|>|<=|<)\s*(${NUMBER_SOURCE})$`,
);
const COLUMN_FILTER_HELP = 'Use exact text, *wildcard*, <> value, 100..200, has *text*, !has value, and combine terms with AND / OR.';

export function reorderColumns(columns: string[], source: string, target: string): string[] {
  if (source === target) return columns;
  const next = [...columns];
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return columns;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

/**
 * Compile every non-empty table-column input independently. Invalid fields
 * are reported by name and excluded from the preview expression so renderer
 * callers can retain the last valid criteria instead of sending partial input.
 */
export function compileColumnFilters(filters: ColumnFilterMap): CompiledColumnFilters {
  const compiledFields: Array<{ property: string; clause: string; logical: boolean }> = [];
  const errors: Record<string, string> = {};

  for (const [field, rawSource] of Object.entries(filters)) {
    const source = rawSource.trim();
    if (!source) continue;
    try {
      const compiled = compileFieldFilter(field, source);
      compiledFields.push(compiled);
    } catch (error) {
      errors[field] = error instanceof Error ? error.message : String(error);
    }
  }

  if (compiledFields.length === 0) return { expression: '{}', errors };
  if (!compiledFields.some((field) => field.logical)) {
    return {
      expression: `{\n${compiledFields.map((field) => `  ${field.property}`).join(',\n')}\n}`,
      errors,
    };
  }

  const clauses = compiledFields.map((field) => field.clause);
  return {
    expression: clauses.length === 1
      ? clauses[0]!
      : `{\n  "$and": [\n${clauses.map((clause) => `    ${clause}`).join(',\n')}\n  ]\n}`,
    errors,
  };
}

export function buildColumnFilterExpression(filters: ColumnFilterMap): string {
  const compiled = compileColumnFilters(filters);
  const firstError = Object.entries(compiled.errors)[0];
  if (firstError) {
    throw new ColumnFilterSyntaxError(`${firstError[0]}: ${firstError[1]}`);
  }
  return compiled.expression;
}

export function columnFilterHelpText(): string {
  return COLUMN_FILTER_HELP;
}

function columnFilterValue(source: string): string {
  const membership = /^(!?has)\s+(.+)$/i.exec(source);
  if (membership) {
    const value = membershipLiteral(membership[2]!);
    const operator = membership[1]!.startsWith('!') ? '$nin' : '$in';
    return `{ ${JSON.stringify(operator)}: [${value}] }`;
  }
  if (/^!?has\b/i.test(source)) {
    throw new ColumnFilterSyntaxError('Array membership requires a value after has or !has.');
  }

  const range = RANGE_PATTERN.exec(source);
  if (range) {
    const lower = numericValue(range[1]!);
    const upper = numericValue(range[2]!);
    validateRange(lower, upper, false, false);
    return `{ "$gte": ${range[1]!}, "$lte": ${range[2]!} }`;
  }
  if (!isQuotedLiteral(source) && source.includes('..')) {
    throw new ColumnFilterSyntaxError('Range must use two numeric bounds, for example 100..200.');
  }

  const compound = COMPOUND_COMPARISON_PATTERN.exec(source);
  if (compound) {
    return compoundComparisonValue(
      compound[1]!,
      compound[2]!,
      compound[3]!,
      compound[4]!,
    );
  }

  const comparison = /^(>=|<=|<>|!=|>|<|=)\s*(.+)$/.exec(source);
  if (comparison) {
    const operator = comparison[1]!;
    const value = scalarLiteral(comparison[2]!);
    if (operator === '=') return value;
    const mongoOperator = operator === '>'
      ? '$gt'
      : operator === '>='
        ? '$gte'
        : operator === '<'
          ? '$lt'
          : operator === '<='
            ? '$lte'
            : '$ne';
    return `{ ${JSON.stringify(mongoOperator)}: ${value} }`;
  }
  if (/^(?:>=|<=|<>|!=|>|<|=)/.test(source)) {
    throw new ColumnFilterSyntaxError('Comparison operator requires a value.');
  }

  if (source.includes('*')) {
    if (/^\*+$/.test(source)) return `{ "$exists": true }`;
    const anchored = wildcardRegexPattern(source);
    return `{ "$regex": ${JSON.stringify(anchored)}, "$options": "i" }`;
  }

  return scalarLiteral(source);
}

function compileFieldFilter(
  field: string,
  source: string,
): { property: string; clause: string; logical: boolean } {
  const parsed = logicalOrClause(field, source);
  if (parsed.logical) return { property: '', clause: parsed.clause, logical: true };
  const value = columnFilterValue(source);
  const property = `${JSON.stringify(field)}: ${value}`;
  return { property, clause: `{ ${property} }`, logical: false };
}

function logicalOrClause(field: string, source: string): { clause: string; logical: boolean } {
  const parts = splitTopLevelLogical(source, 'or');
  if (parts.length > 1) {
    const clauses = parts.map((part) => logicalAndClause(field, part).clause);
    return { clause: logicalClause('$or', clauses), logical: true };
  }
  return logicalAndClause(field, source);
}

function logicalAndClause(field: string, source: string): { clause: string; logical: boolean } {
  const parts = splitTopLevelLogical(source, 'and');
  if (parts.length > 1) {
    const clauses = parts.map((part) => fieldClause(field, part));
    return { clause: logicalClause('$and', clauses), logical: true };
  }
  return { clause: fieldClause(field, source), logical: false };
}

function fieldClause(field: string, source: string): string {
  return `{ ${JSON.stringify(field)}: ${columnFilterValue(source.trim())} }`;
}

function logicalClause(operator: '$and' | '$or', clauses: string[]): string {
  return `{ ${JSON.stringify(operator)}: [${clauses.join(', ')}] }`;
}

/** Split AND/OR only outside quoted strings, regex literals and BSON constructor arguments. */
function splitTopLevelLogical(source: string, operator: 'and' | 'or'): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: '"' | "'" | '`' | null = null;
  let regex = false;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (regex) {
      if (character === '/') regex = false;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '/') {
      regex = true;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;

    const symbol = operator === 'and' ? '&&' : '||';
    const wordMatches = source.slice(index, index + operator.length).toLowerCase() === operator &&
      logicalBoundary(source[index - 1]) && logicalBoundary(source[index + operator.length]);
    const symbolMatches = source.startsWith(symbol, index);
    if (!wordMatches && !symbolMatches) continue;

    const part = source.slice(start, index).trim();
    if (!part) throw new ColumnFilterSyntaxError(`${operator.toUpperCase()} requires a filter on both sides.`);
    parts.push(part);
    index += (symbolMatches ? symbol.length : operator.length) - 1;
    start = index + 1;
  }

  if (parts.length === 0) return [source];
  const finalPart = source.slice(start).trim();
  if (!finalPart) throw new ColumnFilterSyntaxError(`${operator.toUpperCase()} requires a filter on both sides.`);
  parts.push(finalPart);
  return parts;
}

function logicalBoundary(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

function membershipLiteral(source: string): string {
  const value = source.trim();
  const wildcard = membershipWildcardText(value);
  if (wildcard !== null) {
    return `BSONRegExp(${JSON.stringify(wildcardRegexPattern(wildcard))}, "i")`;
  }
  return scalarLiteral(value);
}

function membershipWildcardText(source: string): string | null {
  if (!isQuotedLiteral(source)) return source.includes('*') ? source : null;
  try {
    const parsed = JSON.parse(
      parseDocumentExpression(`{ value: ${source} }`, 'Column filter value').json,
    ) as { value?: unknown };
    return typeof parsed.value === 'string' && parsed.value.includes('*') ? parsed.value : null;
  } catch (error) {
    throw new ColumnFilterSyntaxError(error instanceof Error ? error.message : String(error));
  }
}

function wildcardRegexPattern(source: string): string {
  const startsWithWildcard = source.startsWith('*');
  const endsWithWildcard = source.endsWith('*');
  const pattern = source
    .split('*')
    .map(escapeRegex)
    .join('.*');
  return `${startsWithWildcard ? '' : '^'}${pattern}${endsWithWildcard ? '' : '$'}`;
}

function compoundComparisonValue(
  firstOperator: string,
  firstSource: string,
  secondOperator: string,
  secondSource: string,
): string {
  const bounds = [
    comparisonBound(firstOperator, firstSource),
    comparisonBound(secondOperator, secondSource),
  ];
  const lower = bounds.find((bound) => bound.side === 'lower');
  const upper = bounds.find((bound) => bound.side === 'upper');
  if (!lower || !upper) {
    throw new ColumnFilterSyntaxError('A range needs one lower bound and one upper bound.');
  }
  validateRange(lower.value, upper.value, lower.exclusive, upper.exclusive);
  return `{ ${JSON.stringify(lower.mongoOperator)}: ${lower.source}, ${JSON.stringify(upper.mongoOperator)}: ${upper.source} }`;
}

function comparisonBound(operator: string, source: string): {
  side: 'lower' | 'upper';
  mongoOperator: '$gt' | '$gte' | '$lt' | '$lte';
  source: string;
  value: number;
  exclusive: boolean;
} {
  const lower = operator === '>' || operator === '>=';
  return {
    side: lower ? 'lower' : 'upper',
    mongoOperator: operator === '>' ? '$gt' : operator === '>=' ? '$gte' : operator === '<' ? '$lt' : '$lte',
    source,
    value: numericValue(source),
    exclusive: operator === '>' || operator === '<',
  };
}

function validateRange(lower: number, upper: number, lowerExclusive: boolean, upperExclusive: boolean): void {
  if (lower > upper || (lower === upper && (lowerExclusive || upperExclusive))) {
    throw new ColumnFilterSyntaxError('Range lower bound must be less than its upper bound.');
  }
}

function numericValue(source: string): number {
  const value = Number(source);
  if (!Number.isFinite(value)) {
    throw new ColumnFilterSyntaxError('Range bounds must be finite numbers.');
  }
  return value;
}

function scalarLiteral(source: string): string {
  const value = source.trim();
  if (!value) throw new ColumnFilterSyntaxError('A filter value is required.');
  if (NUMBER_PATTERN.test(value)) return value;
  if (value === 'true' || value === 'false' || value === 'null') return value;

  if (looksLikeStaticLiteral(value)) {
    try {
      parseDocumentExpression(`{ value: ${value} }`, 'Column filter value');
      return value;
    } catch (error) {
      throw new ColumnFilterSyntaxError(error instanceof Error ? error.message : String(error));
    }
  }

  return JSON.stringify(value);
}

function looksLikeStaticLiteral(source: string): boolean {
  return isQuotedLiteral(source) ||
    source.startsWith('{') ||
    source.startsWith('[') ||
    source.startsWith('/') ||
    source.startsWith('`') ||
    /^new\s+[$A-Z_a-z][$\w]*\s*\(/.test(source) ||
    /^[$A-Z_a-z][$\w]*\(/.test(source);
}

function isQuotedLiteral(source: string): boolean {
  return source.startsWith('"') || source.startsWith("'");
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
