/**
 * Result serialization for the wire (ADR-08). Thin wrapper over shared/ejson
 * adding per-page byte budgets so a single page can never blow up IPC.
 */
import {
  byteLength,
  serializeToEjson,
  type EjsonEnvelope,
} from '../../shared/ejson/index.js';

export interface PageBudget {
  maxDocBytes: number;
  maxPageBytes: number;
}

export const DEFAULT_PAGE_BUDGET: PageBudget = {
  maxDocBytes: 256 * 1024, // per-document preview cap
  maxPageBytes: 8 * 1024 * 1024, // whole-page IPC cap
};

export interface SerializedPage {
  documents: EjsonEnvelope[];
  totalBytes: number;
  /** True when the page was cut short by maxPageBytes. */
  cutShort: boolean;
}

export function serializeDocuments(
  docs: unknown[],
  budget: PageBudget = DEFAULT_PAGE_BUDGET,
): SerializedPage {
  const documents: EjsonEnvelope[] = [];
  let totalBytes = 0;
  let cutShort = false;
  for (const doc of docs) {
    const env = serializeToEjson(doc, budget.maxDocBytes);
    const envBytes = byteLength(env.ejson);
    if (totalBytes + envBytes > budget.maxPageBytes) {
      cutShort = true;
      break;
    }
    documents.push(env);
    totalBytes += envBytes;
  }
  return { documents, totalBytes, cutShort };
}

export { serializeToEjson };
