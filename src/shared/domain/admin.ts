import type { EjsonEnvelope } from '../ejson/index.js';

export type ExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution';

export interface IndexDescription {
  name: string;
  key: EjsonEnvelope;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: EjsonEnvelope;
}

export interface GlobalSearchMatch {
  collection: string;
  document: EjsonEnvelope;
}

export interface GlobalSearchResult {
  matches: GlobalSearchMatch[];
  scannedCollections: number;
  scannedDocuments: number;
  maxDocumentsPerCollection: number;
  truncated: boolean;
  sampled: true;
}

export interface ChangeStreamStartResult {
  streamId: string;
}

export interface ChangeStreamPollResult {
  events: EjsonEnvelope[];
  closed: boolean;
}

export interface GridFsFileInfo {
  id: EjsonEnvelope;
  filename: string;
  length: number;
  chunkSize: number;
  uploadDate: string;
  metadata?: EjsonEnvelope;
}

export interface GridFsUploadResult {
  id: EjsonEnvelope;
  filename: string;
  length: number;
}

export interface GridFsDialogResult<T> {
  cancelled: boolean;
  value?: T;
}
