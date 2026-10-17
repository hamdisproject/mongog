/**
 * Query editor completion policy (runs inside the TS worker: no monaco import).
 * The TypeScript service lists every ambient global — DOM included, though
 * scripts run in a Node vm without it — next to the MongoDB shell helpers.
 * Keep the shell helpers and core JS, rank the shell helpers first, and leave
 * member completions (db.…) and the script's own declarations alone. Type
 * declarations are untouched, so hidden helpers still type-check when typed.
 */

/** TypeScript SortText.GlobalsOrKeywords and SortText.LocationPriority. */
const GLOBALS_OR_KEYWORDS = '15';
const LOCATION_PRIORITY = '11';

const MONGO_SHELL_GLOBALS = new Set([
  'db', 'client', 'use', 'print', 'printjson', 'mongodb', 'bson', 'ObjectId', 'ISODate', 'UUID',
]);

const CORE_JS_GLOBALS = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object',
  'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'console', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'undefined', 'NaN', 'Infinity',
]);

export interface QueryCompletionEntry {
  name: string;
  kind: string;
  kindModifiers?: string;
  sortText: string;
}

export interface QueryCompletionInfo {
  isMemberCompletion: boolean;
  entries: QueryCompletionEntry[];
}

export function filterQueryCompletions<T extends QueryCompletionInfo>(info: T | undefined): T | undefined {
  if (!info || info.isMemberCompletion) return info;
  const entries = info.entries.flatMap((entry) => {
    const ambient = entry.kindModifiers?.split(',').includes('declare') ?? false;
    if (entry.sortText !== GLOBALS_OR_KEYWORDS || entry.kind === 'keyword' || !ambient) return [entry];
    if (MONGO_SHELL_GLOBALS.has(entry.name)) return [{ ...entry, sortText: LOCATION_PRIORITY }];
    return CORE_JS_GLOBALS.has(entry.name) ? [entry] : [];
  });
  return { ...info, entries };
}
