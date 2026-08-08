/**
 * Runtime supervisor (ADR-04): one utility process per active connection,
 * lazily spawned, idle-timed, hard-capped, restarted on demand after crash.
 */
import { EventEmitter } from 'node:events';
import { resolveRuntimeEntry } from './paths.js';
import { RuntimeClient } from './runtime-client.js';
import type { EngineEvent, ExportProgressEvent } from '../../shared/domain/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';

export interface SupervisorOptions {
  maxRuntimes?: number;
  idleTimeoutMS?: number;
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
}

const DEFAULTS = { maxRuntimes: 10, idleTimeoutMS: 15 * 60 * 1000 } as const;

export class RuntimeSupervisor extends EventEmitter {
  private runtimes = new Map<string, ManagedRuntime>();
  private readonly maxRuntimes: number;
  private readonly idleTimeoutMS: number;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(options: SupervisorOptions = {}) {
    super();
    this.maxRuntimes = options.maxRuntimes ?? DEFAULTS.maxRuntimes;
    this.idleTimeoutMS = options.idleTimeoutMS ?? DEFAULTS.idleTimeoutMS;
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
      existing.lastUsedAt = Date.now();
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
      this.emit('engine-event', connectionId, executionId, event, tabId, runId);
    });
    client.onExportProgress((event: ExportProgressEvent) => {
      this.emit('export-progress', connectionId, event);
    });
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

    const connectedAt = Date.now();
    this.runtimes.set(connectionId, {
      client,
      lastUsedAt: connectedAt,
      connectedAt,
      serverVersion: init.serverVersion,
      uri,
      options,
    });
    this.emit('runtime-ready', connectionId, { ...init, connectedAt });
    return client;
  }

  touch(connectionId: string): void {
    const rt = this.runtimes.get(connectionId);
    if (rt) rt.lastUsedAt = Date.now();
  }

  get(connectionId: string): RuntimeClient | null {
    const rt = this.runtimes.get(connectionId);
    if (rt?.client.isAlive) {
      rt.lastUsedAt = Date.now();
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

  private async evictIdle(): Promise<void> {
    const now = Date.now();
    for (const [id, rt] of [...this.runtimes.entries()]) {
      if (now - rt.lastUsedAt > this.idleTimeoutMS) {
        await this.dispose(id);
        this.emit('runtime-idle-evicted', id);
      }
    }
  }
}
