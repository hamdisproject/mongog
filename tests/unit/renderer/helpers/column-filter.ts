import { parseDocumentExpression } from '../../../../src/features/script-analysis/index.js';

export function parseColumnFilter(source: string): Record<string, unknown> {
  return JSON.parse(parseDocumentExpression(source, 'Filter').json) as Record<string, unknown>;
}

export function lengthExpression(
  field: string,
  comparisons: Array<[operator: string, value: number]>,
): Record<string, unknown> {
  const isArray = { $isArray: `$${field}` };
  const safeSize = { $size: { $cond: [isArray, `$${field}`, []] } };
  return {
    $expr: {
      $and: [
        isArray,
        ...comparisons.map(([operator, value]) => ({ [operator]: [safeSize, value] })),
      ],
    },
  };
}
