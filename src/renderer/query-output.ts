import type { QueryResult } from '../shared/domain/index.js';
import type { AppError } from '../shared/errors/index.js';
import {
  parseEjson,
  renderBson,
  type BsonDisplayMode,
  type EjsonEnvelope,
} from '../shared/ejson/index.js';
import { formatConsoleOutput } from './console-output.js';

export function formatQueryResultOutput(result: QueryResult, mode: BsonDisplayMode): string {
  switch (result.kind) {
    case 'documents':
      return renderBson(result.documents.map(envelopeValue), mode, true);
    case 'scalar':
    case 'command':
      return renderQueryEnvelope(result.value, mode, true);
    case 'write': {
      const summary: Record<string, unknown> = { op: result.op };
      if (result.insertedCount !== undefined) summary.inserted = result.insertedCount;
      if (result.matchedCount !== undefined) summary.matched = result.matchedCount;
      if (result.modifiedCount !== undefined) summary.modified = result.modifiedCount;
      if (result.deletedCount !== undefined) summary.deleted = result.deletedCount;
      if (result.upsertedCount !== undefined) summary.upserted = result.upsertedCount;
      if (result.raw) summary.raw = envelopeValue(result.raw);
      return renderBson(summary, mode, true);
    }
    case 'console':
      return formatConsoleOutput(result.entries, mode);
    case 'changeStream':
      return `Change stream ${result.streamId.slice(0, 8)}… (${result.buffered} buffered)`;
    case 'opaque':
      return result.preview;
    case 'error':
      return formatQueryErrorOutput(result.error);
  }
}

export function formatQueryErrorOutput(error: AppError): string {
  return [
    `${error.category}: ${error.message}`,
    ...(error.hint ? [`Hint: ${error.hint}`] : []),
  ].join('\n');
}

export function renderQueryEnvelope(
  envelope: EjsonEnvelope,
  mode: BsonDisplayMode,
  pretty: boolean,
): string {
  if (envelope.truncated) {
    return `${envelope.ejson}\n… truncated preview (${formatBytes(envelope.byteSize)} original)`;
  }
  try {
    return renderBson(parseEjson(envelope), mode, pretty);
  } catch {
    return envelope.ejson;
  }
}

function envelopeValue(envelope: EjsonEnvelope): unknown {
  if (envelope.truncated) {
    return {
      $preview: envelope.ejson,
      $truncated: true,
      $originalBytes: envelope.byteSize,
    };
  }
  try {
    return parseEjson(envelope);
  } catch {
    return { $preview: envelope.ejson, $parseError: true };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
