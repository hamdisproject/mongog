/**
 * Skip/limit page math for the Documents browser (ADR-0014).
 *
 * A page normally holds `pageSize` documents, but the runtime cuts a page short
 * when it would exceed the IPC byte budget. The next page therefore starts at
 * `skip + documents.length`, and Previous returns to the recorded start of the
 * page before it instead of assuming full pages.
 */

export interface DocumentPageStep {
  skip: number;
  /** Starts of the pages visited before `skip`, newest last. */
  history: number[];
}

export function pageNumberOf(skip: number, pageSize: number): number {
  return Math.floor(Math.max(0, skip) / Math.max(1, pageSize)) + 1;
}

export function totalPagesOf(totalCount: number | null, pageSize: number): number | null {
  if (totalCount === null) return null;
  return Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
}

export function nextPageStep(skip: number, documentCount: number, history: readonly number[]): DocumentPageStep {
  return { skip: skip + Math.max(1, documentCount), history: [...history, skip] };
}

export function previousPageStep(skip: number, pageSize: number, history: readonly number[]): DocumentPageStep {
  const remaining = [...history];
  const recorded = remaining.pop();
  return {
    skip: recorded !== undefined && recorded < skip ? recorded : Math.max(0, skip - pageSize),
    history: remaining,
  };
}

/**
 * Start of a requested page number (1-based). Returns null for input that is
 * not a whole page number or lies beyond a known last page.
 */
export function skipForPageNumber(pageNumber: number, pageSize: number, totalPages: number | null): number | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  if (totalPages !== null && pageNumber > totalPages) return null;
  return (pageNumber - 1) * Math.max(1, pageSize);
}
