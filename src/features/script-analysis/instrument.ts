/** AST instrumentation and automatic awaiting; original statement ranges stay authoritative. */
import type { ParsedScript, TopLevelStatement } from './parse.js';
import type { AutoAwaitProjection } from './auto-await-projection.js';
import { lowerAutoAwait } from './auto-await.js';

export interface InstrumentedProgram {
  /** Full runnable JavaScript (async IIFE). */
  code: string;
  runtimeIdentifier: string;
  projection: AutoAwaitProjection;
  capturedStatementIndexes: number[];
}

export function buildInstrumentedSource(source: string, parsed: ParsedScript): InstrumentedProgram {
  return lowerAutoAwait(source, parsed);
}

/** Statements a user can run individually. */
export function isRunnableStatement(stmt: TopLevelStatement): boolean {
  return stmt.kind !== 'other';
}
