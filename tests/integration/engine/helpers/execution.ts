import type { MongoClient } from 'mongodb';

import type { ExecutionEngine } from '../../../../src/query-runtime/engine/execute.js';
import type { CursorRegistry } from '../../../../src/query-runtime/registry/cursors.js';
import type { EngineEvent, QueryResult } from '../../../../src/shared/domain/index.js';

export interface CollectedEngineEvents {
  events: EngineEvent[];
  results: Array<{ index: number; result: QueryResult }>;
  errors: Array<{ index: number; category?: string; message: string }>;
  finished?: { status: string; durationMs: number };
}

export function collectEngineEvents(events: EngineEvent[]): CollectedEngineEvents {
  const collected: CollectedEngineEvents = { events, results: [], errors: [] };
  for (const event of events) {
    if (event.type === 'result') collected.results.push({ index: event.index, result: event.result });
    if (event.type === 'statement-error') {
      collected.errors.push({
        index: event.index,
        category: event.error.category,
        message: event.error.message,
      });
    }
    if (event.type === 'execution-finished') {
      collected.finished = { status: event.status, durationMs: event.durationMs };
    }
  }
  return collected;
}

export async function executeAndCollect(
  engine: ExecutionEngine,
  client: MongoClient,
  registry: CursorRegistry,
  database: string,
  source: string,
  extra: Partial<Parameters<ExecutionEngine['execute']>[0]> = {},
): Promise<CollectedEngineEvents> {
  const events: EngineEvent[] = [];
  const handle = engine.execute(
    {
      client,
      database,
      source,
      mode: 'query',
      registry,
      owner: { connectionId: 'test' },
      ...extra,
    },
    (event) => events.push(event),
  );
  await handle.promise;
  return collectEngineEvents(events);
}
