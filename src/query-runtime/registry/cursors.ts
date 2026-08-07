/**
 * Cursor & change-stream registry (ADR-09, plan §9/§21).
 *
 * Live driver cursors NEVER leave this process. The renderer only sees
 * opaque cursorIds and paged, serialized documents. Pages are fetched with
 * cursor.next()/hasNext() — toArray() on user cursors is never called.
 */
import { randomUUID } from 'node:crypto';
import type { ChangeStreamPollResult, DocumentsPage } from '../../shared/domain/index.js';
import { appError } from '../../shared/errors/index.js';
import {
  byteLength,
  serializeToEjsonWithFull,
  type EjsonEnvelope,
} from '../../shared/ejson/index.js';
import { DEFAULT_PAGE_BUDGET, type PageBudget } from '../serialize/index.js';

export interface CursorOwner {
  connectionId: string;
  tabId?: string;
  resultId?: string;
}

interface PageRecord {
  documents: EjsonEnvelope[];
  bytes: number;
  hasMore: boolean;
  fullValueIds: string[];
}

interface FullValueRecord {
  envelope: EjsonEnvelope;
  bytes: number;
}

interface CursorEntry {
  cursorId: string;
  owner: CursorOwner;
  cursor: CursorLike;
  namespace: string;
  createdAt: number;
  lastTouchedAt: number;
  pages: PageRecord[]; // retained page window for fetchPrev
  currentPageIndex: number; // index of the last page sent
  retainedBytes: number;
  fullValues: Map<string, FullValueRecord>;
  fullValueBytes: number;
  closed: boolean;
  /** One-document lookahead: pulled but not sent (page byte budget). */
  pending: unknown | typeof EMPTY;
}

const EMPTY = Symbol('mongog.empty');

interface StreamEntry {
  streamId: string;
  owner: CursorOwner;
  stream: ChangeStreamLike;
  createdAt: number;
  lastTouchedAt: number;
  buffered: number;
  closed: boolean;
}

/** Structural subset of driver AbstractCursor used by the registry. */
export interface CursorLike {
  next(): Promise<unknown | null>;
  hasNext(): Promise<boolean>;
  close(): Promise<void>;
  readonly closed: boolean;
}

export interface ChangeStreamLike {
  close(): Promise<void>;
  readonly closed: boolean;
  next(): Promise<unknown>;
  tryNext(): Promise<unknown | null>;
}

export interface CursorRegistryOptions {
  idleTimeoutMS?: number;
  maxRetainedPages?: number;
  pageBudget?: PageBudget;
  /** Per-cursor LRU budget for explicitly fetchable oversized values. */
  maxFullValueBytes?: number;
  sweepIntervalMS?: number;
  now?: () => number;
}

const DEFAULTS = {
  idleTimeoutMS: 10 * 60 * 1000,
  maxRetainedPages: 20,
  maxFullValueBytes: 64 * 1024 * 1024,
  sweepIntervalMS: 30_000,
} as const;

export class CursorRegistry {
  private cursors = new Map<string, CursorEntry>();
  private streams = new Map<string, StreamEntry>();
  private readonly idleTimeoutMS: number;
  private readonly maxRetainedPages: number;
  private readonly maxFullValueBytes: number;
  private readonly pageBudget: PageBudget;
  private readonly now: () => number;
  private sweeper: NodeJS.Timeout | undefined;

  constructor(options: CursorRegistryOptions = {}) {
    this.idleTimeoutMS = options.idleTimeoutMS ?? DEFAULTS.idleTimeoutMS;
    this.maxRetainedPages = options.maxRetainedPages ?? DEFAULTS.maxRetainedPages;
    this.maxFullValueBytes = options.maxFullValueBytes ?? DEFAULTS.maxFullValueBytes;
    this.pageBudget = options.pageBudget ?? DEFAULT_PAGE_BUDGET;
    this.now = options.now ?? Date.now;
  }

  startSweeper(intervalMS: number = DEFAULTS.sweepIntervalMS): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.closeIdle(), intervalMS);
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  get size(): number {
    return this.cursors.size;
  }

  register(cursor: CursorLike, owner: CursorOwner, namespace: string): string {
    const cursorId = randomUUID();
    this.cursors.set(cursorId, {
      cursorId,
      owner,
      cursor,
      namespace,
      createdAt: this.now(),
      lastTouchedAt: this.now(),
      pages: [],
      currentPageIndex: -1,
      retainedBytes: 0,
      fullValues: new Map(),
      fullValueBytes: 0,
      closed: false,
      pending: EMPTY,
    });
    return cursorId;
  }

  registerStream(stream: ChangeStreamLike, owner: CursorOwner): string {
    const streamId = randomUUID();
    this.streams.set(streamId, {
      streamId,
      owner,
      stream,
      createdAt: this.now(),
      lastTouchedAt: this.now(),
      buffered: 0,
      closed: false,
    });
    return streamId;
  }

  /** Non-blocking, bounded polling for a registered change stream. */
  async pollStream(streamId: string, maxEvents: number): Promise<ChangeStreamPollResult> {
    const entry = this.getOpenStream(streamId);
    entry.lastTouchedAt = this.now();
    const events: EjsonEnvelope[] = [];
    try {
      while (events.length < maxEvents && !entry.stream.closed) {
        const event = await entry.stream.tryNext();
        if (event == null) break;
        events.push(serializeToEjsonWithFull(event).preview);
      }
    } catch (error) {
      if (entry.stream.closed) {
        await this.closeStream(streamId);
        return { events, closed: true };
      }
      throw appError('MongoDBCommand', `Change stream polling failed: ${(error as Error).message}`, {
        name: (error as Error).name,
      });
    }
    const closed = entry.stream.closed;
    if (closed) await this.closeStream(streamId);
    return { events, closed };
  }

  /**
   * Pull up to `pageSize` documents within the byte budget. Documents are
   * serialized as they arrive; a document that would exceed the page budget
   * is stashed in a one-element lookahead buffer (never dropped).
   */
  async fetchNext(cursorId: string, pageSize: number): Promise<DocumentsPage> {
    const entry = this.getOpen(cursorId);
    entry.lastTouchedAt = this.now();

    // After fetchPrev(), walk forward through the retained window before
    // advancing the live driver cursor. Otherwise a page is skipped.
    if (entry.currentPageIndex < entry.pages.length - 1) {
      entry.currentPageIndex += 1;
      const retained = entry.pages[entry.currentPageIndex]!;
      return {
        documents: retained.documents,
        hasMore: retained.hasMore,
        pageIndex: entry.currentPageIndex,
        retainedBytes: entry.retainedBytes,
      };
    }

    const envelopes: EjsonEnvelope[] = [];
    const fullValueIds: string[] = [];
    let totalBytes = 0;

    while (envelopes.length < pageSize) {
      let doc: unknown;
      if (entry.pending !== EMPTY) {
        doc = entry.pending;
        entry.pending = EMPTY;
      } else {
        try {
          doc = await entry.cursor.next();
        } catch (err) {
          throw appError('MongoDBCommand', `Cursor iteration failed: ${(err as Error).message}`, {
            name: (err as Error).name,
          });
        }
        if (doc == null) break;
      }
      const serialized = serializeToEjsonWithFull(doc, this.pageBudget.maxDocBytes);
      const env = serialized.preview;
      const envBytes = byteLength(env.ejson);
      if (envelopes.length > 0 && totalBytes + envBytes > this.pageBudget.maxPageBytes) {
        entry.pending = doc; // keep for the next page — no document is lost
        break;
      }
      if (serialized.full) {
        const fullValueId = this.retainFullValue(entry, serialized.full);
        if (fullValueId) {
          env.fullValueId = fullValueId;
          fullValueIds.push(fullValueId);
        }
      }
      envelopes.push(env);
      totalBytes += envBytes;
    }

    let hasMore = entry.pending !== EMPTY;
    if (!hasMore && !entry.cursor.closed) {
      try {
        hasMore = await entry.cursor.hasNext();
      } catch {
        hasMore = false;
      }
    }

    const page: PageRecord = {
      documents: envelopes,
      bytes: totalBytes,
      hasMore,
      fullValueIds,
    };
    entry.pages.push(page);
    entry.currentPageIndex = entry.pages.length - 1;
    entry.retainedBytes += totalBytes;
    this.enforceRetainedWindow(entry);

    return {
      documents: envelopes,
      hasMore,
      pageIndex: entry.currentPageIndex,
      retainedBytes: entry.retainedBytes,
    };
  }

  /** Serve a previously retained page (windowed; does not touch the cursor). */
  fetchPrev(cursorId: string): DocumentsPage {
    const entry = this.getOpen(cursorId);
    entry.lastTouchedAt = this.now();
    if (entry.currentPageIndex <= 0) {
      throw appError('CursorNotFound', 'No previous page retained.', { name: 'CursorNotFound' });
    }
    entry.currentPageIndex -= 1;
    const page = entry.pages[entry.currentPageIndex]!;
    return {
      documents: page.documents,
      hasMore: true, // a newer page exists by definition
      pageIndex: entry.currentPageIndex,
      retainedBytes: entry.retainedBytes,
    };
  }

  /** Fetch an oversized value retained for one document in this cursor. */
  fetchFullValue(cursorId: string, fullValueId: string): EjsonEnvelope {
    const entry = this.getOpen(cursorId);
    entry.lastTouchedAt = this.now();
    const record = entry.fullValues.get(fullValueId);
    if (!record) {
      throw appError('CursorNotFound', 'The full document value is no longer retained.', {
        name: 'CursorNotFound',
        hint: 'Re-run the query to fetch this document again.',
      });
    }
    // Refresh insertion order for LRU eviction.
    entry.fullValues.delete(fullValueId);
    entry.fullValues.set(fullValueId, record);
    return record.envelope;
  }

  async close(cursorId: string): Promise<void> {
    const entry = this.cursors.get(cursorId);
    if (!entry) return;
    entry.closed = true;
    this.cursors.delete(cursorId);
    if (!entry.cursor.closed) {
      await entry.cursor.close().catch(() => undefined);
    }
  }

  async closeStream(streamId: string): Promise<void> {
    const entry = this.streams.get(streamId);
    if (!entry) return;
    entry.closed = true;
    this.streams.delete(streamId);
    if (!entry.stream.closed) {
      await entry.stream.close().catch(() => undefined);
    }
  }

  /** Bulk cleanup by owner: tab close, disconnect, runtime shutdown. */
  async closeAllForOwner(predicate: Partial<CursorOwner>): Promise<number> {
    let count = 0;
    for (const entry of [...this.cursors.values()]) {
      if (ownerMatches(entry.owner, predicate)) {
        await this.close(entry.cursorId);
        count += 1;
      }
    }
    for (const entry of [...this.streams.values()]) {
      if (ownerMatches(entry.owner, predicate)) {
        await this.closeStream(entry.streamId);
        count += 1;
      }
    }
    return count;
  }

  async closeIdle(now = this.now()): Promise<number> {
    let count = 0;
    for (const entry of [...this.cursors.values()]) {
      if (now - entry.lastTouchedAt > this.idleTimeoutMS) {
        await this.close(entry.cursorId);
        count += 1;
      }
    }
    for (const entry of [...this.streams.values()]) {
      if (now - entry.lastTouchedAt > this.idleTimeoutMS) {
        await this.closeStream(entry.streamId);
        count += 1;
      }
    }
    return count;
  }

  async dispose(): Promise<void> {
    this.stopSweeper();
    for (const id of [...this.cursors.keys()]) await this.close(id);
    for (const id of [...this.streams.keys()]) await this.closeStream(id);
  }

  private getOpen(cursorId: string): CursorEntry {
    const entry = this.cursors.get(cursorId);
    if (!entry || entry.closed) {
      throw appError('CursorNotFound', `Cursor ${cursorId} is closed or expired.`, {
        name: 'CursorNotFound',
        hint: 'The cursor may have expired after the idle timeout; re-run the query.',
      });
    }
    return entry;
  }

  private getOpenStream(streamId: string): StreamEntry {
    const entry = this.streams.get(streamId);
    if (!entry || entry.closed) {
      throw appError('CursorNotFound', `Change stream ${streamId} is closed or expired.`, {
        name: 'CursorNotFound',
        hint: 'Start the change stream again.',
      });
    }
    return entry;
  }

  private enforceRetainedWindow(entry: CursorEntry): void {
    while (entry.pages.length > this.maxRetainedPages) {
      const dropped = entry.pages.shift();
      entry.retainedBytes -= dropped?.bytes ?? 0;
      for (const fullValueId of dropped?.fullValueIds ?? []) {
        this.dropFullValue(entry, fullValueId);
      }
      entry.currentPageIndex -= 1;
    }
  }

  private retainFullValue(entry: CursorEntry, envelope: EjsonEnvelope): string | null {
    if (envelope.byteSize > this.maxFullValueBytes) return null;
    while (
      entry.fullValueBytes + envelope.byteSize > this.maxFullValueBytes &&
      entry.fullValues.size > 0
    ) {
      const oldestId = entry.fullValues.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.dropFullValue(entry, oldestId);
    }
    const fullValueId = randomUUID();
    entry.fullValues.set(fullValueId, { envelope, bytes: envelope.byteSize });
    entry.fullValueBytes += envelope.byteSize;
    return fullValueId;
  }

  private dropFullValue(entry: CursorEntry, fullValueId: string): void {
    const record = entry.fullValues.get(fullValueId);
    if (!record) return;
    entry.fullValues.delete(fullValueId);
    entry.fullValueBytes -= record.bytes;
  }
}

function ownerMatches(owner: CursorOwner, predicate: Partial<CursorOwner>): boolean {
  if (predicate.connectionId && owner.connectionId !== predicate.connectionId) return false;
  if (predicate.tabId && owner.tabId !== predicate.tabId) return false;
  if (predicate.resultId && owner.resultId !== predicate.resultId) return false;
  return true;
}
