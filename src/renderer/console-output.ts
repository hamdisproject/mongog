import type { ConsoleEntry } from '../shared/domain/index.js';
import {
  parseEjson,
  renderBson,
  type BsonDisplayMode,
  type EjsonEnvelope,
} from '../shared/ejson/index.js';

export function formatConsoleEntry(entry: ConsoleEntry, mode: BsonDisplayMode): string {
  const prefix = `console.${entry.level}`;
  if (entry.args.length === 0) return prefix;
  return `${prefix} ${entry.args.map((argument) => formatConsoleArgument(argument, mode)).join(' ')}`;
}

export function formatConsoleOutput(entries: ConsoleEntry[], mode: BsonDisplayMode): string {
  return entries.map((entry) => formatConsoleEntry(entry, mode)).join('\n');
}

function formatConsoleArgument(envelope: EjsonEnvelope, mode: BsonDisplayMode): string {
  if (envelope.truncated) {
    return `${envelope.ejson}\n… truncated preview (${formatBytes(envelope.byteSize)} original)`;
  }
  try {
    return renderBson(parseEjson(envelope), mode, false);
  } catch {
    return envelope.ejson;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
