import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type {
  DataJobProgressEvent,
  EngineEvent,
  ExportProgressEvent,
} from '../../src/shared/domain/index.js';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/tmp/mongog-test', isPackaged: false },
  utilityProcess: { fork: vi.fn() },
}));

vi.mock('../../src/main/runtime/runtime-client.js', async () => {
  const { EventEmitter: RuntimeEventEmitter } = await import('node:events');
  return {
    RuntimeClient: class FakeRuntimeClient extends RuntimeEventEmitter {
      isAlive = true;
      pendingCount = 0;
      pid = 42;
      requests: Array<{ type: string; payload: Record<string, unknown> | undefined }> = [];

      async start(): Promise<void> {}

      async request<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
        this.requests.push({ type, payload });
        return { pid: this.pid, serverVersion: '8.0.0' } as T;
      }

      onEngineEvent(listener: (...args: unknown[]) => void): void {
        this.on('engine-event', listener);
      }

      onExportProgress(listener: (...args: unknown[]) => void): void {
        this.on('export-progress', listener);
      }

      onDataJobProgress(listener: (...args: unknown[]) => void): void {
        this.on('data-job-progress', listener);
      }

      async kill(): Promise<void> {
        this.isAlive = false;
      }
    },
  };
});

import {
  RuntimeSupervisor,
  shouldEvictIdleRuntime,
} from '../../src/main/runtime/supervisor.js';

describe('runtime supervisor idle lifecycle', () => {
  it('defaults to one hour and supports changing to Never at runtime', () => {
    const supervisor = new RuntimeSupervisor();
    expect(supervisor.getIdleTimeoutMS()).toBe(60 * 60 * 1000);

    supervisor.setIdleTimeoutMS(0);
    expect(supervisor.getIdleTimeoutMS()).toBe(0);
    expect(() => supervisor.setIdleTimeoutMS(-1)).toThrow(/non-negative integer/i);
    expect(() => supervisor.setIdleTimeoutMS(1.5)).toThrow(/non-negative integer/i);
  });

  it('evicts only an inactive runtime at or beyond the configured duration', () => {
    expect(shouldEvictIdleRuntime({
      now: 3_599_999,
      lastUsedAt: 0,
      idleTimeoutMS: 3_600_000,
      busy: false,
    })).toBe(false);
    expect(shouldEvictIdleRuntime({
      now: 3_600_000,
      lastUsedAt: 0,
      idleTimeoutMS: 3_600_000,
      busy: false,
    })).toBe(true);
  });

  it('resets open runtime timers when the setting changes', async () => {
    let now = 0;
    const supervisor = new RuntimeSupervisor({ idleTimeoutMS: 100, now: () => now });
    await supervisor.ensure('conn-1', 'mongodb://localhost');

    now = 90;
    supervisor.setIdleTimeoutMS(50);
    now = 139;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);

    now = 140;
    await sweep(supervisor);
    expect(supervisor.size).toBe(0);
  });

  it('does not evict a Never connection', async () => {
    let now = 0;
    const supervisor = new RuntimeSupervisor({ idleTimeoutMS: 0, now: () => now });
    await supervisor.ensure('conn-1', 'mongodb://localhost');

    now = Number.MAX_SAFE_INTEGER;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);
  });

  it('protects running queries, exports, data transfers and Change Streams', async () => {
    let now = 0;
    const supervisor = new RuntimeSupervisor({ idleTimeoutMS: 100, now: () => now });
    const client = await supervisor.ensure('conn-1', 'mongodb://localhost');
    const emitter = client as unknown as EventEmitter;

    emitter.emit('engine-event', 'exec-1', {
      type: 'execution-started', executionId: 'exec-1', statements: [],
    } satisfies EngineEvent);
    now = 100;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);
    emitter.emit('engine-event', 'exec-1', {
      type: 'execution-finished', status: 'completed', durationMs: 100,
    } satisfies EngineEvent);

    emitter.emit('export-progress', exportEvent('running'));
    now = 200;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);
    emitter.emit('export-progress', exportEvent('completed'));

    supervisor.trackDataJobProgress(dataJobEvent('preparing'));
    now = 300;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);
    supervisor.trackDataJobProgress(dataJobEvent('completed'));

    supervisor.setChangeStreamActive('conn-1', 'stream-1', true);
    now = 400;
    await sweep(supervisor);
    expect(supervisor.size).toBe(1);
    supervisor.setChangeStreamActive('conn-1', 'stream-1', false);

    now = 500;
    await sweep(supervisor);
    expect(supervisor.size).toBe(0);
  });

  it('single-flights a hard restart and reuses only the in-memory connection config', async () => {
    const supervisor = new RuntimeSupervisor();
    const original = await supervisor.ensure('conn-1', 'mongodb://localhost/app', {
      directConnection: true,
    });
    const restarting = vi.fn();
    supervisor.on('runtime-restarting', restarting);

    const [first, second] = await Promise.all([
      supervisor.restart('conn-1', {
        reason: 'stuck execution',
        executionId: 'exec-1',
        runId: 'run-1',
      }),
      supervisor.restart('conn-1', {
        reason: 'duplicate request',
        executionId: 'exec-1',
        runId: 'run-1',
      }),
    ]);

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(first).not.toBe(original);
    expect(original.isAlive).toBe(false);
    expect(restarting).toHaveBeenCalledTimes(1);
    expect(restarting).toHaveBeenCalledWith('conn-1', {
      reason: 'stuck execution',
      executionId: 'exec-1',
      runId: 'run-1',
    });
    expect((first as typeof original & { requests: Array<{ type: string; payload?: Record<string, unknown> }> })
      .requests[0]).toMatchObject({
        type: 'init',
        payload: {
          uri: 'mongodb://localhost/app',
          options: { directConnection: true },
        },
      });
  });

  it('tracks the renderer context while an execution is active', async () => {
    const supervisor = new RuntimeSupervisor();
    const client = await supervisor.ensure('conn-1', 'mongodb://localhost');
    const emitter = client as unknown as EventEmitter;
    emitter.emit('engine-event', 'exec-1', {
      type: 'execution-started', executionId: 'exec-1', statements: [],
    } satisfies EngineEvent, 'tab-1', 'run-1');
    expect(supervisor.getExecutionContext('conn-1', 'exec-1')).toEqual({
      tabId: 'tab-1',
      runId: 'run-1',
    });
    emitter.emit('engine-event', 'exec-1', {
      type: 'execution-finished', status: 'cancelled', durationMs: 1,
    } satisfies EngineEvent, 'tab-1', 'run-1');
    expect(supervisor.getExecutionContext('conn-1', 'exec-1')).toBeNull();
  });
});

async function sweep(supervisor: RuntimeSupervisor): Promise<void> {
  await (supervisor as unknown as { evictIdle(): Promise<void> }).evictIdle();
}

function exportEvent(status: ExportProgressEvent['status']): ExportProgressEvent {
  return {
    jobId: 'export-1',
    connectionId: 'conn-1',
    status,
    phase: status === 'completed' ? 'finalizing' : 'reading',
    processedRows: 0,
    filename: 'export.csv',
    warningCount: 0,
  };
}

function dataJobEvent(status: DataJobProgressEvent['status']): DataJobProgressEvent {
  return {
    jobId: 'transfer-1',
    kind: 'connection-copy',
    status,
    phase: status === 'completed' ? 'finalizing' : 'preflight',
    connectionIds: ['conn-1'],
    datasetIndex: 0,
    datasetCount: 1,
    rowsRead: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
}
