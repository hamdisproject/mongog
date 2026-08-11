/**
 * Runtime supervisor (ADR-04): one utility process per active connection,
 * lazily spawned, idle-timed, hard-capped, restarted on demand after crash.
 */
import { EventEmitter } from 'node:events';
import { resolveRuntimeEntry } from './paths.js';
import { RuntimeClient } from './runtime-client.js';
import type { DataJobProgressEvent, EngineEvent, ExportProgressEvent } from '../../shared/domain/index.js';
import { DEFAULT_CONNECTION_IDLE_TIMEOUT_MS } from '../../shared/domain/workspace.js';
import { appError, serializeError } from '../../shared/errors/index.js';

export interface SupervisorOptions {
  maxRuntimes?: number;
  idleTimeoutMS?: number;
  now?: () => number;
}

export interface RuntimeInfo {
  pid?: number;
  serverVersion: string;
  connectedAt: number;
}

interface ManagedRuntime {
  client: RuntimeClient;
  lastUsedAt: number;
  connectedAt: number;
  serverVersion: string;
  uri: string;
  options: Record<string, unknown>;
  activeActivities: Set<string>;
}

const DEFAULTS = { maxRuntimes: 10, idleTimeoutMS: DEFAULT_CONNECTION_IDLE_TIMEOUT_MS } as const;

export class RuntimeSupervisor extends EventEmitter {
  private runtimes = new Map<string, ManagedRuntime>();
  private readonly maxRuntimes: number;
  private idleTimeoutMS: number;
  private readonly now: () => number;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(options: SupervisorOptions = {}) {
    super();
    this.maxRuntimes = options.maxRuntimes ?? DEFAULTS.maxRuntimes;
    this.idleTimeoutMS = options.idleTimeoutMS ?? DEFAULTS.idleTimeoutMS;
    this.now = options.now ?? Date.now;
  }

  startSweeper(intervalMS = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.evictIdle(), intervalMS);
    this.sweeper.unref?.();
  }

  get size(): number {
    return this.runtimes.size;
  }

  async ensure(
    connectionId: string,
    uri: string,
    options: Record<string, unknown> = {},
  ): Promise<RuntimeClient> {
    const existing = this.runtimes.get(connectionId);
    if (existing?.client.isAlive) {
      existing.lastUsedAt = this.now();
      return existing.client;
    }
    if (existing) await this.dispose(connectionId);

    if (this.runtimes.size >= this.maxRuntimes) {
      throw appError(
        'Unknown',
        `Maximum active runtimes (${this.maxRuntimes}) reached. Disconnect a connection first.`,
        { hint: 'Raise execution.maxRuntimes in settings if needed.' },
      );
    }

    const client = new RuntimeClient({ entryPath: resolveRuntimeEntry(), connectionId });
    client.onEngineEvent((executionId, event: EngineEvent, tabId?: string, runId?: string) => {
      this.trackEngineActivity(connectionId, executionId, event);
      this.emit('engine-event', connectionId, executionId, event, tabId, runId);
    });
    client.onExportProgress((event: ExportProgressEvent) => {
      this.trackExportActivity(connectionId, event);
      this.emit('export-progress', connectionId, event);
    });
    client.onDataJobProgress((event: DataJobProgressEvent) => {
      this.trackDataJobProgress(event);
      this.emit('data-job-progress', connectionId, event);
    });
    client.on('request-settled', () => this.touch(connectionId));
    client.on('exit', () => {
      const current = this.runtimes.get(connectionId);
      // dispose() removes the entry before killing the child. Only an
      // unexpected exit of the currently managed runtime is a crash.
      if (current?.client !== client) return;
      this.runtimes.delete(connectionId);
      this.emit('runtime-exit', connectionId);
    });
    this.emit('runtime-connecting', connectionId);

    let init: { pid: number; serverVersion: string };
    try {
      await client.start();
      init = await client.request<{ pid: number; serverVersion: string }>('init', {
        uri,
        options,
      });
    } catch (err) {
      await client.kill().catch(() => undefined);
      this.emit('runtime-connect-error', connectionId, serializeError(err));
      throw err;
    }

    const connectedAt = this.now();
    this.runtimes.set(connectionId, {
      client,
      lastUsedAt: connectedAt,
      connectedAt,
      serverVersion: init.serverVersion,
      uri,
      options,
      activeActivities: new Set(),
    });
    this.emit('runtime-ready', connectionId, { ...init, connectedAt });
    return client;
  }

  touch(connectionId: string): void {
    const rt = this.runtimes.get(connectionId);
    if (rt) rt.lastUsedAt = this.now();
  }

  get(connectionId: string): RuntimeClient | null {
    const rt = this.runtimes.get(connectionId);
    if (rt?.client.isAlive) {
      rt.lastUsedAt = this.now();
      return rt.client;
    }
    return null;
  }

  getInfo(connectionId: string): RuntimeInfo | null {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime?.client.isAlive) return null;
    return {
      pid: runtime.client.pid,
      serverVersion: runtime.serverVersion,
      connectedAt: runtime.connectedAt,
    };
  }

  async dispose(connectionId: string): Promise<void> {
    const rt = this.runtimes.get(connectionId);
    this.runtimes.delete(connectionId);
    if (rt) await rt.client.kill();
  }

  async terminate(connectionId: string, reason: string): Promise<void> {
    const runtime = this.runtimes.get(connectionId);
    this.runtimes.delete(connectionId);
    if (!runtime) return;
    await runtime.client.kill();
    this.emit('runtime-force-killed', connectionId, reason);
  }

  async disposeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    await Promise.all([...this.runtimes.keys()].map((id) => this.dispose(id)));
  }

  setIdleTimeoutMS(idleTimeoutMS: number, resetActivity = true): void {
    if (!Number.isInteger(idleTimeoutMS) || idleTimeoutMS < 0) {
      throw new TypeError('Connection idle timeout must be a non-negative integer.');
    }
    this.idleTimeoutMS = idleTimeoutMS;
    if (!resetActivity) return;
    const now = this.now();
    for (const runtime of this.runtimes.values()) runtime.lastUsedAt = now;
  }

  getIdleTimeoutMS(): number {
    return this.idleTimeoutMS;
  }

  trackDataJobProgress(event: DataJobProgressEvent): void {
    const key = `data-job:${event.jobId}`;
    const terminal = event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled';
    for (const connectionId of event.connectionIds) {
      if (terminal) this.endActivity(connectionId, key);
      else this.beginActivity(connectionId, key);
    }
  }

  setChangeStreamActive(connectionId: string, streamId: string, active: boolean): void {
    const key = `change-stream:${streamId}`;
    if (active) this.beginActivity(connectionId, key);
    else this.endActivity(connectionId, key);
  }

  private async evictIdle(): Promise<void> {
    const now = this.now();
    for (const [id, rt] of [...this.runtimes.entries()]) {
      if (shouldEvictIdleRuntime({
        now,
        lastUsedAt: rt.lastUsedAt,
        idleTimeoutMS: this.idleTimeoutMS,
        busy: rt.client.pendingCount > 0 || rt.activeActivities.size > 0,
      })) {
        await this.dispose(id);
        this.emit('runtime-idle-evicted', id, this.idleTimeoutMS);
      }
    }
  }

  private beginActivity(connectionId: string, key: string): void {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) return;
    runtime.activeActivities.add(key);
    runtime.lastUsedAt = this.now();
  }

  private endActivity(connectionId: string, key: string): void {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) return;
    runtime.activeActivities.delete(key);
    runtime.lastUsedAt = this.now();
  }

  private trackEngineActivity(connectionId: string, executionId: string, event: EngineEvent): void {
    const key = `execution:${executionId}`;
    if (event.type === 'execution-started') this.beginActivity(connectionId, key);
    else if (event.type === 'execution-finished') this.endActivity(connectionId, key);
    else this.touch(connectionId);
  }

  private trackExportActivity(connectionId: string, event: ExportProgressEvent): void {
    const key = `export:${event.jobId}`;
    if (event.status === 'running') this.beginActivity(connectionId, key);
    else this.endActivity(connectionId, key);
  }
}

export function shouldEvictIdleRuntime(input: {
  now: number;
  lastUsedAt: number;
  idleTimeoutMS: number;
  busy: boolean;
}): boolean {
  return input.idleTimeoutMS > 0 && !input.busy && input.now - input.lastUsedAt >= input.idleTimeoutMS;
}
