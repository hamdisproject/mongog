/**
 * Typed client for one query-runtime utility process (ADR-04).
 * Request/response correlation by incrementing id; engine events are routed
 * to listeners by executionId.
 */
import { EventEmitter } from 'node:events';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { DataJobProgressEvent, EngineEvent, ExportProgressEvent } from '../../shared/domain/index.js';
import { appError, serializeError, type AppError } from '../../shared/errors/index.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: AppError) => void;
  timer?: NodeJS.Timeout;
}

export interface RuntimeClientOptions {
  entryPath: string;
  connectionId: string;
  requestTimeoutMS?: number;
}

export interface RuntimeRequestOptions {
  /** Zero disables the main-process timeout for a tracked long-running server command. */
  timeoutMS?: number;
}

const MESSAGE_TIMEOUT = 120_000;

export class RuntimeClient extends EventEmitter {
  private child: UtilityProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMS: number;
  readonly connectionId: string;
  private readonly entryPath: string;
  private exitInfo: { code: number | null; at: number } | null = null;

  constructor(options: RuntimeClientOptions) {
    super();
    this.entryPath = options.entryPath;
    this.connectionId = options.connectionId;
    this.requestTimeoutMS = options.requestTimeoutMS ?? MESSAGE_TIMEOUT;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isAlive(): boolean {
    return this.child !== null && this.exitInfo === null;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async start(): Promise<void> {
    if (this.child && this.isAlive) return;
    this.exitInfo = null;
    this.child = utilityProcess.fork(this.entryPath, [], {
      serviceName: `MongoG Query Runtime (${this.connectionId})`,
      stdio: 'pipe',
      // Scrubbed environment: do not leak app/keychain env into the runtime.
      env: { ...sanitizeEnv(process.env) },
    });
    this.child.stdout?.on('data', (d) => this.emit('log', 'stdout', String(d)));
    this.child.stderr?.on('data', (d) => this.emit('log', 'stderr', String(d)));
    this.child.on('message', (msg: unknown) => this.onMessage(msg));
    this.child.on('exit', (code) => this.onExit(code));
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onExitEarly = (code: number | null) => {
        cleanup();
        reject(appError('UtilityProcessCrash', `Query runtime exited during spawn (code ${code}).`));
      };
      const cleanup = () => {
        this.child?.off('spawn', onSpawn);
        this.child?.off('exit', onExitEarly);
      };
      this.child!.once('spawn', onSpawn);
      this.child!.once('exit', onExitEarly);
    });
  }

  async request<T = unknown>(
    type: string,
    payload: Record<string, unknown> = {},
    options: RuntimeRequestOptions = {},
  ): Promise<T> {
    if (!this.child || !this.isAlive) {
      throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMS = options.timeoutMS ?? this.requestTimeoutMS;
      const timer = timeoutMS === 0 ? undefined : setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.emit('request-settled');
        reject(appError('NetworkTimeout', `Runtime request "${type}" timed out.`));
      }, timeoutMS);
      timer?.unref?.();
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      this.child!.postMessage({ id, type, ...payload });
    });
  }

  onEngineEvent(
    listener: (executionId: string, event: EngineEvent, tabId?: string, runId?: string) => void,
  ): void {
    this.on('engine-event', listener);
  }

  onExportProgress(listener: (event: ExportProgressEvent) => void): void {
    this.on('export-progress', listener);
  }

  onDataJobProgress(listener: (event: DataJobProgressEvent) => void): void {
    this.on('data-job-progress', listener);
  }

  async kill(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(appError('UtilityProcessCrash', 'Query runtime was killed.'));
    }
    this.pending.clear();
    child.kill();
  }

  private onMessage(msg: unknown): void {
    const m = msg as {
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: AppError;
      type?: string;
      executionId?: string;
      tabId?: string;
      runId?: string;
      event?: EngineEvent;
      exportEvent?: ExportProgressEvent;
      dataJobEvent?: DataJobProgressEvent;
    };
    if (m.type === 'engine-event' && m.executionId && m.event) {
      this.emit('engine-event', m.executionId, m.event, m.tabId, m.runId);
      return;
    }
    if (m.type === 'export-event' && m.event) {
      this.emit('export-progress', m.event as unknown as ExportProgressEvent);
      return;
    }
    if (m.type === 'data-job-event' && m.event) {
      this.emit('data-job-progress', m.event as unknown as DataJobProgressEvent);
      return;
    }
    if (m.type === 'ready') {
      this.emit('ready', m);
      return;
    }
    if (m.type === 'runtime-error') {
      this.emit('runtime-error', m.error);
      return;
    }
    if (typeof m.id === 'number') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (p.timer) clearTimeout(p.timer);
      this.emit('request-settled');
      if (m.ok) p.resolve(m.value);
      else p.reject(m.error ?? appError('Unknown', 'Runtime request failed.'));
    }
  }

  private onExit(code: number | null): void {
    this.exitInfo = { code, at: Date.now() };
    const err = appError('UtilityProcessCrash', `Query runtime exited (code ${code}).`);
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.emit('exit', code);
  }
}

/** Remove variables that could leak secrets or alter runtime behavior. */
function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (/^MONGOG_/i.test(k)) continue;
    if (/KEYCHAIN|TOKEN|SECRET|PASSWORD/i.test(k)) continue;
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  return out;
}

export function runtimeError(err: unknown): AppError {
  return serializeError(err);
}
