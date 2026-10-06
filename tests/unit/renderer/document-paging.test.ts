import { describe, expect, it } from 'vitest';
import {
  nextPageStep,
  pageNumberOf,
  previousPageStep,
  skipForPageNumber,
  totalPagesOf,
} from '../../../src/renderer/components/Results/document-paging.js';

describe('Documents skip/limit page math', () => {
  it('derives 1-based page numbers and total pages', () => {
    expect(pageNumberOf(0, 50)).toBe(1);
    expect(pageNumberOf(49, 50)).toBe(1);
    expect(pageNumberOf(100, 50)).toBe(3);
    expect(totalPagesOf(null, 50)).toBeNull();
    expect(totalPagesOf(0, 50)).toBe(1);
    expect(totalPagesOf(101, 50)).toBe(3);
  });

  it('starts the next page after the documents actually shown, even when a page was cut short', () => {
    expect(nextPageStep(0, 50, [])).toEqual({ skip: 50, history: [0] });
    expect(nextPageStep(50, 12, [0])).toEqual({ skip: 62, history: [0, 50] });
    expect(nextPageStep(62, 0, [0, 50])).toEqual({ skip: 63, history: [0, 50, 62] });
  });

  it('returns to the recorded start of the previous page, falling back to page arithmetic', () => {
    expect(previousPageStep(62, 50, [0, 50])).toEqual({ skip: 50, history: [0] });
    expect(previousPageStep(250, 50, [])).toEqual({ skip: 200, history: [] });
    expect(previousPageStep(20, 50, [])).toEqual({ skip: 0, history: [] });
    // A stale history entry beyond the current page is ignored.
    expect(previousPageStep(100, 50, [300])).toEqual({ skip: 50, history: [] });
  });

  it('accepts only whole page numbers within the known range', () => {
    expect(skipForPageNumber(1, 50, null)).toBe(0);
    expect(skipForPageNumber(4, 25, 10)).toBe(75);
    expect(skipForPageNumber(11, 25, 10)).toBeNull();
    expect(skipForPageNumber(0, 25, null)).toBeNull();
    expect(skipForPageNumber(2.5, 25, null)).toBeNull();
    expect(skipForPageNumber(Number.NaN, 25, null)).toBeNull();
  });
});
