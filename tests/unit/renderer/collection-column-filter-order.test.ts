import { describe, expect, it } from 'vitest';
import {
  buildColumnFilterExpression,
  compileColumnFilters,
  reorderColumns,
} from '../../../src/renderer/collection-column-filter.js';
import { lengthExpression, parseColumnFilter as parse } from './helpers/column-filter.js';

describe('collection column filters', () => {
  it('reorders a dragged column without losing any column', () => {
    expect(reorderColumns(['_id', 'name', 'quantity'], 'quantity', 'name'))
      .toEqual(['_id', 'quantity', 'name']);
    expect(reorderColumns(['_id', 'name'], 'missing', 'name')).toEqual(['_id', 'name']);
  });
});
