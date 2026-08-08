export type ColumnFilterMap = Record<string, string>;

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

export function buildColumnFilterExpression(filters: ColumnFilterMap): string {
  const entries = Object.entries(filters)
    .map(([field, source]) => [field, source.trim()] as const)
    .filter(([, source]) => source.length > 0);
  if (entries.length === 0) return '{}';

  const lines = entries.map(([field, source]) => (
    `  ${JSON.stringify(field)}: ${columnFilterValue(source)}`
  ));
  return `{\n${lines.join(',\n')}\n}`;
}

function columnFilterValue(source: string): string {
  const comparison = /^(>=|<=|!=|>|<|=)\s*(.+)$/.exec(source);
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

  if (source.includes('*')) {
    if (/^\*+$/.test(source)) return `{ "$exists": true }`;
    const startsWithWildcard = source.startsWith('*');
    const endsWithWildcard = source.endsWith('*');
    const pattern = source
      .split('*')
      .map(escapeRegex)
      .join('.*');
    const anchored = `${startsWithWildcard ? '' : '^'}${pattern}${endsWithWildcard ? '' : '$'}`;
    return `{ "$regex": ${JSON.stringify(anchored)}, "$options": "i" }`;
  }

  return scalarLiteral(source);
}

function scalarLiteral(source: string): string {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(source)) return source;
  if (source === 'true' || source === 'false' || source === 'null') return source;
  if (
    (source.startsWith('"') && source.endsWith('"')) ||
    (source.startsWith("'") && source.endsWith("'"))
  ) return JSON.stringify(source.slice(1, -1));
  return JSON.stringify(source);
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
