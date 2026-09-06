import { describe, expect, it } from 'vitest';
import { offsetSourceRange } from '../../../src/query-runtime/engine/execute.js';

describe('selection source offsets', () => {
  it('offsets the first selected line by line and column', () => {
    expect(offsetSourceRange(
      { startLine: 1, startCol: 1, endLine: 1, endCol: 12 },
      { line: 9, column: 4 },
    )).toEqual({
      startLine: 10,
      startCol: 5,
      endLine: 10,
      endCol: 16,
    });
  });

  it('applies the column only to the first line of a multiline selection', () => {
    expect(offsetSourceRange(
      { startLine: 1, startCol: 3, endLine: 3, endCol: 7 },
      { line: 4, column: 8 },
    )).toEqual({
      startLine: 5,
      startCol: 11,
      endLine: 7,
      endCol: 7,
    });
  });
});
