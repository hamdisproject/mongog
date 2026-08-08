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
const LENGTH_INTEGER_SOURCE = String.raw`(?:0|[1-9]\d*)`;
const LENGTH_RANGE_PATTERN = new RegExp(
  String.raw`^(${LENGTH_INTEGER_SOURCE})\s*\.\.\s*(${LENGTH_INTEGER_SOURCE})$`,
);
const LENGTH_COMPOUND_PATTERN = new RegExp(
  String.raw`^(>=|>|<=|<)\s*(${LENGTH_INTEGER_SOURCE})\s+(>=|>|<=|<)\s*(${LENGTH_INTEGER_SOURCE})$`,
);
const LENGTH_COMPARISON_PATTERN = new RegExp(
  String.raw`^(>=|<=|<>|!=|>|<|=)\s*(${LENGTH_INTEGER_SOURCE})$`,
);
const COLUMN_FILTER_HELP = 'Use exact text, "" for an empty string, *wildcard*, <> value, 100..200, has *text*, len = 3, {field}: value, [{field}]: value, repeated nested selectors, and AND / OR.';
const MAX_SELECTOR_STEPS = 32;

interface CompiledFieldFilter {
  property: string;
  clause: string;
  /** True when this condition cannot be represented as a field property. */
  logical: boolean;
}

interface CompiledLeafFilter {
  property?: string;
  clause: string;
  topLevel: boolean;
}

interface SelectorStep {
  kind: 'object' | 'array';
  field: string;
}

interface NestedLeaf {
  kind: 'leaf';
  steps: SelectorStep[];
  source: string;
}

interface NestedBoolean {
  kind: 'and' | 'or';
  children: NestedFilterNode[];
}

type NestedFilterNode = NestedLeaf | NestedBoolean;

interface ParsedNestedFilter {
  node: NestedFilterNode;
  usedSelector: boolean;
}

interface LengthSpec {
  exact?: number;
  comparisons: Array<[operator: '$gt' | '$gte' | '$lt' | '$lte' | '$ne', value: number]>;
}

interface ExpressionScope {
  variable?: string;
}

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
  const compiledFields: CompiledFieldFilter[] = [];
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
): CompiledFieldFilter {
  const nested = parseNestedFilter(source);
  if (nested.usedSelector) return compileNestedFieldFilter(field, nested.node);

  const parsed = logicalOrClause(field, source);
  if (parsed.logical) return { property: '', clause: parsed.clause, logical: true };
  const leaf = compileLeafFilter(field, source);
  return {
    property: leaf.property ?? '',
    clause: leaf.clause,
    logical: leaf.topLevel,
  };
}

function compileNestedFieldFilter(field: string, node: NestedFilterNode): CompiledFieldFilter {
  const rooted = mapNestedLeaves(node, (leaf) => ({
    ...leaf,
    steps: [{ kind: 'object', field }, ...leaf.steps],
  }));

  if (nestedNodeNeedsExpression(rooted)) {
    const counter = { value: 0 };
    const expression = compileNestedExpression(rooted, {}, counter);
    const clause = `{ "$expr": ${expression} }`;
    return { property: '', clause, logical: true };
  }

  return {
    property: '',
    clause: compileNestedQueryNode(rooted),
    logical: true,
  };
}

function parseNestedFilter(source: string): ParsedNestedFilter {
  const state: { lastSelector?: SelectorStep[]; usedSelector: boolean } = { usedSelector: false };
  const node = parseNestedOr(source, state);
  return { node, usedSelector: state.usedSelector };
}

function parseNestedOr(
  source: string,
  state: { lastSelector?: SelectorStep[]; usedSelector: boolean },
): NestedFilterNode {
  const parts = splitTopLevelLogical(source, 'or');
  if (parts.length === 1) return parseNestedAnd(parts[0]!, state);
  return { kind: 'or', children: parts.map((part) => parseNestedAnd(part, state)) };
}

function parseNestedAnd(
  source: string,
  state: { lastSelector?: SelectorStep[]; usedSelector: boolean },
): NestedFilterNode {
  const parts = splitTopLevelLogical(source, 'and');
  if (parts.length > 1) {
    return { kind: 'and', children: parts.map((part) => parseNestedAtom(part, state)) };
  }
  return parseNestedAtom(parts[0]!, state);
}

function parseNestedAtom(
  source: string,
  state: { lastSelector?: SelectorStep[]; usedSelector: boolean },
): NestedLeaf {
  const atom = source.trim();
  const selector = parseSelectorPrefix(atom);
  if (selector) {
    state.lastSelector = selector.steps;
    state.usedSelector = true;
    return { kind: 'leaf', steps: selector.steps, source: selector.source };
  }
  return {
    kind: 'leaf',
    steps: state.lastSelector ? [...state.lastSelector] : [],
    source: atom,
  };
}

function parseSelectorPrefix(source: string): { steps: SelectorStep[]; source: string } | null {
  let index = 0;
  const steps: SelectorStep[] = [];

  while (true) {
    while (/\s/.test(source[index] ?? '')) index += 1;
    const array = source.startsWith('[{', index);
    const object = source[index] === '{';
    if (!array && !object) break;

    const opening = index;
    const fieldStart = index + (array ? 2 : 1);
    const close = selectorFieldEnd(source, fieldStart);
    if (close < 0) {
      if (steps.length > 0 || array) {
        throw new ColumnFilterSyntaxError('Nested selector is missing a closing } or ].');
      }
      return null;
    }
    if (array && source[close + 1] !== ']') {
      if (steps.length > 0) throw new ColumnFilterSyntaxError('Array selector must end with }].');
      return null;
    }

    const rawField = source.slice(fieldStart, close).trim();
    let field: string;
    try {
      field = selectorFieldName(rawField);
    } catch (error) {
      if (steps.length === 0 && source.slice(opening, close + (array ? 2 : 1)).includes(':')) return null;
      throw error;
    }
    steps.push({ kind: array ? 'array' : 'object', field });
    if (steps.length > MAX_SELECTOR_STEPS) {
      throw new ColumnFilterSyntaxError(`Nested selectors support at most ${MAX_SELECTOR_STEPS} steps.`);
    }
    index = close + (array ? 2 : 1);
  }

  if (steps.length === 0) return null;
  while (/\s/.test(source[index] ?? '')) index += 1;
  if (source[index] !== ':') {
    if (source.slice(0, index).includes(':')) return null;
    throw new ColumnFilterSyntaxError('Nested selector must be followed by a colon (:).');
  }
  const remaining = source.slice(index + 1).trim();
  if (!remaining) throw new ColumnFilterSyntaxError('Nested selector requires a filter value after colon (:).');
  return { steps, source: remaining };
}

function selectorFieldEnd(source: string, start: number): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
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
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '}') return index;
  }
  return -1;
}

function selectorFieldName(rawField: string): string {
  if (!rawField) throw new ColumnFilterSyntaxError('Nested selector field cannot be empty.');
  let field = rawField;
  if (isQuotedLiteral(rawField)) {
    try {
      const parsed = JSON.parse(
        parseDocumentExpression(`{ value: ${rawField} }`, 'Nested selector field').json,
      ) as { value?: unknown };
      if (typeof parsed.value !== 'string') throw new Error('Selector field must be a string.');
      field = parsed.value;
    } catch (error) {
      throw new ColumnFilterSyntaxError(error instanceof Error ? error.message : String(error));
    }
  }
  if (!field || field.includes('.') || field.includes('\0') || field.startsWith('$')) {
    throw new ColumnFilterSyntaxError('Nested selector fields cannot be empty, contain dots or NUL, or start with $.');
  }
  return field;
}

function mapNestedLeaves(
  node: NestedFilterNode,
  mapper: (leaf: NestedLeaf) => NestedLeaf,
): NestedFilterNode {
  if (node.kind === 'leaf') return mapper(node);
  return { ...node, children: node.children.map((child) => mapNestedLeaves(child, mapper)) };
}

function nestedLeaves(node: NestedFilterNode): NestedLeaf[] {
  if (node.kind === 'leaf') return [node];
  return node.children.flatMap(nestedLeaves);
}

function nestedNodeNeedsExpression(node: NestedFilterNode): boolean {
  return nestedLeaves(node).some((leaf) => {
    const length = parseLengthSpec(leaf.source);
    return length !== null && length.exact === undefined;
  });
}

function compileNestedQueryNode(node: NestedFilterNode): string {
  const sharedArray = sharedFirstArrayContext(node);
  if (sharedArray) return compileNestedQueryArray(node, sharedArray);
  if (node.kind === 'leaf') return compileNestedQueryLeaf(node);

  const grouped = groupNestedChildren(node);
  const clauses = grouped.map((child) => compileNestedQueryNode(child));
  return logicalClause(node.kind === 'and' ? '$and' : '$or', clauses);
}

function compileNestedQueryArray(node: NestedFilterNode, prefix: SelectorStep[]): string {
  const transformed = consumeArrayContext(node, prefix.length);
  const arrayPath = selectorPath(prefix);
  const elemMatch = `{ ${JSON.stringify(arrayPath)}: { "$elemMatch": ${compileNestedQueryNode(transformed)} } }`;
  const guards = queryObjectGuards(prefix.slice(0, -1));
  return guards.length === 0 ? elemMatch : logicalClause('$and', [...guards, elemMatch]);
}

function compileNestedQueryLeaf(leaf: NestedLeaf): string {
  const path = selectorPath(leaf.steps);
  const length = parseLengthSpec(leaf.source);
  const value = length?.exact !== undefined
    ? `{ "$size": ${length.exact} }`
    : columnFilterValue(leaf.source);
  const clause = `{ ${JSON.stringify(path)}: ${value} }`;
  const guards = queryObjectGuards(leaf.steps.slice(0, -1));
  return guards.length === 0 ? clause : logicalClause('$and', [...guards, clause]);
}

function queryObjectGuards(steps: SelectorStep[]): string[] {
  const guards: string[] = [];
  for (let length = 1; length <= steps.length; length += 1) {
    const prefix = steps.slice(0, length);
    if (prefix.some((step) => step.kind === 'array')) break;
    guards.push(`{ ${JSON.stringify(selectorPath(prefix))}: { "$type": "object" } }`);
  }
  return guards;
}

function selectorPath(steps: SelectorStep[]): string {
  return steps.map((step) => step.field).join('.');
}

function firstArrayPrefix(leaf: NestedLeaf): SelectorStep[] | null {
  const index = leaf.steps.findIndex((step) => step.kind === 'array');
  return index < 0 ? null : leaf.steps.slice(0, index);
}

function sharedFirstArrayContext(node: NestedFilterNode): SelectorStep[] | null {
  const leaves = nestedLeaves(node);
  if (leaves.length === 0) return null;
  const first = firstArrayPrefix(leaves[0]!);
  if (!first) return null;
  const key = selectorContextKey(first);
  return leaves.every((leaf) => {
    const prefix = firstArrayPrefix(leaf);
    return prefix !== null && selectorContextKey(prefix) === key;
  }) ? first : null;
}

function selectorContextKey(steps: SelectorStep[]): string {
  return steps.map((step) => `${step.kind}:${step.field}`).join('\u0001');
}

function consumeArrayContext(node: NestedFilterNode, prefixLength: number): NestedFilterNode {
  return mapNestedLeaves(node, (leaf) => {
    const arrayStep = leaf.steps[prefixLength];
    if (!arrayStep || arrayStep.kind !== 'array') {
      throw new ColumnFilterSyntaxError('Nested array selector contexts do not align.');
    }
    return {
      ...leaf,
      steps: [{ kind: 'object', field: arrayStep.field }, ...leaf.steps.slice(prefixLength + 1)],
    };
  });
}

function groupNestedChildren(node: NestedBoolean): NestedFilterNode[] {
  const grouped = new Map<string, { prefix: SelectorStep[]; children: NestedFilterNode[] }>();
  const output: NestedFilterNode[] = [];
  for (const child of node.children) {
    const prefix = sharedFirstArrayContext(child) ?? (child.kind === 'leaf' ? firstArrayPrefix(child) : null);
    if (!prefix) {
      output.push(child);
      continue;
    }
    const key = selectorContextKey(prefix);
    const bucket = grouped.get(key) ?? { prefix, children: [] };
    bucket.children.push(child);
    grouped.set(key, bucket);
  }
  for (const bucket of grouped.values()) {
    output.push(bucket.children.length === 1
      ? bucket.children[0]!
      : { kind: node.kind, children: bucket.children });
  }
  return output;
}

function compileNestedExpression(
  node: NestedFilterNode,
  scope: ExpressionScope,
  counter: { value: number },
): string {
  const sharedArray = sharedFirstArrayContext(node);
  if (sharedArray) return compileNestedArrayExpression(node, sharedArray, scope, counter);
  if (node.kind === 'leaf') return compileNestedLeafExpression(node, scope, counter);

  const children = groupNestedChildren(node).map((child) => compileNestedExpression(child, scope, counter));
  return expressionLogical(node.kind === 'and' ? '$and' : '$or', children);
}

function compileNestedArrayExpression(
  node: NestedFilterNode,
  prefix: SelectorStep[],
  scope: ExpressionScope,
  counter: { value: number },
): string {
  const arrayReference = expressionReference(scope, prefix);
  const isArray = expressionIsType(arrayReference, 'array');
  const variable = `nestedItem${counter.value++}`;
  const transformed = consumeArrayContext(node, prefix.length);
  const childExpression = compileNestedExpression(transformed, { variable }, counter);
  const objectElement = expressionIsType(JSON.stringify(`$$${variable}`), 'object');
  const mapped = `{ "$map": { "input": { "$cond": [${isArray}, ${arrayReference}, []] }, "as": ${JSON.stringify(variable)}, "in": ${expressionLogical('$and', [objectElement, childExpression])} } }`;
  const anyElement = `{ "$anyElementTrue": ${mapped} }`;
  return expressionLogical('$and', [
    ...expressionObjectGuards(scope, prefix.slice(0, -1)),
    isArray,
    anyElement,
  ]);
}

function compileNestedLeafExpression(
  leaf: NestedLeaf,
  scope: ExpressionScope,
  counter: { value: number },
): string {
  const reference = expressionReference(scope, leaf.steps);
  return expressionLogical('$and', [
    ...expressionObjectGuards(scope, leaf.steps.slice(0, -1)),
    conditionExpression(leaf.source, reference, counter),
  ]);
}

function expressionObjectGuards(scope: ExpressionScope, steps: SelectorStep[]): string[] {
  const guards: string[] = [];
  for (let length = 1; length <= steps.length; length += 1) {
    const prefix = steps.slice(0, length);
    if (prefix.some((step) => step.kind === 'array')) break;
    guards.push(expressionIsType(expressionReference(scope, prefix), 'object'));
  }
  return guards;
}

function expressionReference(scope: ExpressionScope, steps: SelectorStep[]): string {
  const path = selectorPath(steps);
  if (scope.variable) return JSON.stringify(`$$${scope.variable}${path ? `.${path}` : ''}`);
  if (!path) throw new ColumnFilterSyntaxError('A nested filter field is required.');
  return JSON.stringify(`$${path}`);
}

function expressionIsType(reference: string, type: 'array' | 'object' | 'string'): string {
  if (type === 'array') return `{ "$isArray": ${reference} }`;
  return `{ "$eq": [{ "$type": ${reference} }, ${JSON.stringify(type)}] }`;
}

function expressionLogical(operator: '$and' | '$or', expressions: string[]): string {
  if (expressions.length === 1) return expressions[0]!;
  return `{ ${JSON.stringify(operator)}: [${expressions.join(', ')}] }`;
}

function conditionExpression(source: string, reference: string, counter: { value: number }): string {
  const length = parseLengthSpec(source);
  if (length) return lengthConditionExpression(length, reference);

  const membership = /^(!?has)\s+(.+)$/i.exec(source);
  if (membership) {
    const wildcard = membershipWildcardText(membership[2]!.trim());
    const memberVariable = `nestedMember${counter.value++}`;
    const memberReference = JSON.stringify(`$$${memberVariable}`);
    const predicate = wildcard === null
      ? expressionComparison('$eq', memberReference, scalarLiteral(membership[2]!))
      : wildcardExpression(memberReference, wildcardRegexPattern(wildcard));
    const isArray = expressionIsType(reference, 'array');
    const mapped = `{ "$map": { "input": { "$cond": [${isArray}, ${reference}, []] }, "as": ${JSON.stringify(memberVariable)}, "in": ${predicate} } }`;
    const has = expressionLogical('$and', [isArray, `{ "$anyElementTrue": ${mapped} }`]);
    return membership[1]!.startsWith('!') ? `{ "$not": [${has}] }` : has;
  }
  if (/^!?has\b/i.test(source)) {
    throw new ColumnFilterSyntaxError('Array membership requires a value after has or !has.');
  }

  const range = RANGE_PATTERN.exec(source);
  if (range) {
    const lower = numericValue(range[1]!);
    const upper = numericValue(range[2]!);
    validateRange(lower, upper, false, false);
    return expressionLogical('$and', [
      expressionComparison('$gte', reference, range[1]!),
      expressionComparison('$lte', reference, range[2]!),
    ]);
  }
  if (!isQuotedLiteral(source) && source.includes('..')) {
    throw new ColumnFilterSyntaxError('Range must use two numeric bounds, for example 100..200.');
  }

  const compound = COMPOUND_COMPARISON_PATTERN.exec(source);
  if (compound) {
    const bounds = [
      comparisonBound(compound[1]!, compound[2]!),
      comparisonBound(compound[3]!, compound[4]!),
    ];
    const lower = bounds.find((bound) => bound.side === 'lower');
    const upper = bounds.find((bound) => bound.side === 'upper');
    if (!lower || !upper) throw new ColumnFilterSyntaxError('A range needs one lower bound and one upper bound.');
    validateRange(lower.value, upper.value, lower.exclusive, upper.exclusive);
    return expressionLogical('$and', [
      expressionComparison(lower.mongoOperator, reference, lower.source),
      expressionComparison(upper.mongoOperator, reference, upper.source),
    ]);
  }

  const comparison = /^(>=|<=|<>|!=|>|<|=)\s*(.+)$/.exec(source);
  if (comparison) {
    const operator = comparison[1]!;
    const literal = scalarLiteral(comparison[2]!);
    return expressionComparison(
      operator === '=' ? '$eq' : lengthMongoOperator(operator),
      reference,
      literal,
      operator === '<>' || operator === '!=',
    );
  }
  if (/^(?:>=|<=|<>|!=|>|<|=)/.test(source)) {
    throw new ColumnFilterSyntaxError('Comparison operator requires a value.');
  }

  if (source.includes('*')) {
    if (/^\*+$/.test(source)) return `{ "$ne": [{ "$type": ${reference} }, "missing"] }`;
    return wildcardExpression(reference, wildcardRegexPattern(source));
  }
  if (source.startsWith('/')) return regexExpression(reference, source);
  return expressionComparison('$eq', reference, scalarLiteral(source));
}

function expressionComparison(
  operator: '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte',
  reference: string,
  literal: string,
  missingMatches = false,
): string {
  const comparison = `{ ${JSON.stringify(operator)}: [${reference}, { "$literal": ${literal} }] }`;
  if (!missingMatches) return comparison;
  return expressionLogical('$or', [
    `{ "$eq": [{ "$type": ${reference} }, "missing"] }`,
    comparison,
  ]);
}

function wildcardExpression(reference: string, pattern: string): string {
  return regexExpression(reference, JSON.stringify(pattern), 'i');
}

function regexExpression(reference: string, regex: string, options?: string): string {
  const isString = expressionIsType(reference, 'string');
  const payload = options
    ? `{ "input": ${reference}, "regex": ${regex}, "options": ${JSON.stringify(options)} }`
    : `{ "input": ${reference}, "regex": ${regex} }`;
  return expressionLogical('$and', [isString, `{ "$regexMatch": ${payload} }`]);
}

function lengthConditionExpression(length: LengthSpec, reference: string): string {
  const isArray = expressionIsType(reference, 'array');
  const safeSize = `{ "$size": { "$cond": [${isArray}, ${reference}, []] } }`;
  const comparisons = length.exact !== undefined
    ? [`{ "$eq": [${safeSize}, ${length.exact}] }`]
    : length.comparisons.map(([operator, value]) => `{ ${JSON.stringify(operator)}: [${safeSize}, ${value}] }`);
  return expressionLogical('$and', [isArray, ...comparisons]);
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
  return compileLeafFilter(field, source.trim()).clause;
}

function compileLeafFilter(field: string, source: string): CompiledLeafFilter {
  const length = compileLengthFilter(field, source);
  if (length) return length;
  const property = `${JSON.stringify(field)}: ${columnFilterValue(source)}`;
  return { property, clause: `{ ${property} }`, topLevel: false };
}

function compileLengthFilter(field: string, source: string): CompiledLeafFilter | null {
  const length = parseLengthSpec(source);
  if (!length) return null;
  if (length.exact !== undefined) {
    const property = `${JSON.stringify(field)}: { "$size": ${length.exact} }`;
    return { property, clause: `{ ${property} }`, topLevel: false };
  }
  return lengthExpressionFilter(field, length.comparisons);
}

function parseLengthSpec(source: string): LengthSpec | null {
  const match = /^len\b\s*(.*)$/i.exec(source);
  if (!match) return null;
  const condition = match[1]!.trim();
  if (!condition) {
    throw new ColumnFilterSyntaxError('len requires a non-negative integer condition, for example len = 3.');
  }

  const range = LENGTH_RANGE_PATTERN.exec(condition);
  if (range) {
    const lower = lengthInteger(range[1]!);
    const upper = lengthInteger(range[2]!);
    validateRange(lower, upper, false, false);
    return { comparisons: [['$gte', lower], ['$lte', upper]] };
  }

  const compound = LENGTH_COMPOUND_PATTERN.exec(condition);
  if (compound) {
    const bounds = [
      comparisonBound(compound[1]!, compound[2]!),
      comparisonBound(compound[3]!, compound[4]!),
    ];
    const lower = bounds.find((bound) => bound.side === 'lower');
    const upper = bounds.find((bound) => bound.side === 'upper');
    if (!lower || !upper) {
      throw new ColumnFilterSyntaxError('A len range needs one lower bound and one upper bound.');
    }
    validateRange(lower.value, upper.value, lower.exclusive, upper.exclusive);
    return { comparisons: [
      [lower.mongoOperator, lower.value],
      [upper.mongoOperator, upper.value],
    ] };
  }

  const comparison = LENGTH_COMPARISON_PATTERN.exec(condition);
  if (comparison) {
    const operator = comparison[1]!;
    const value = lengthInteger(comparison[2]!);
    if (operator === '=') return { exact: value, comparisons: [] };
    return { comparisons: [[lengthMongoOperator(operator), value]] };
  }

  throw new ColumnFilterSyntaxError(
    'len supports non-negative integers with =, !=, <>, >, >=, <, <=, or a range such as len 2..5.',
  );
}

function lengthExpressionFilter(
  field: string,
  comparisons: Array<[operator: '$gt' | '$gte' | '$lt' | '$lte' | '$ne', value: number]>,
): CompiledLeafFilter {
  const fieldReference = JSON.stringify(`$${field}`);
  const isArray = `{ "$isArray": ${fieldReference} }`;
  const safeSize = `{ "$size": { "$cond": [${isArray}, ${fieldReference}, []] } }`;
  const predicates = comparisons.map(([operator, value]) => (
    `{ ${JSON.stringify(operator)}: [${safeSize}, ${value}] }`
  ));
  const clause = `{ "$expr": { "$and": [${isArray}, ${predicates.join(', ')}] } }`;
  return { clause, topLevel: true };
}

function lengthMongoOperator(operator: string): '$gt' | '$gte' | '$lt' | '$lte' | '$ne' {
  if (operator === '>') return '$gt';
  if (operator === '>=') return '$gte';
  if (operator === '<') return '$lt';
  if (operator === '<=') return '$lte';
  return '$ne';
}

function lengthInteger(source: string): number {
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ColumnFilterSyntaxError('Array length must be a non-negative safe integer.');
  }
  return value;
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
