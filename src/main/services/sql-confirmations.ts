import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 60_000;
const MAX_PENDING_CONFIRMATIONS = 1_000;

export interface SqlConfirmationContext {
  connectionId: string;
  database: string;
  source: string;
}

interface PendingConfirmation {
  digest: string;
  expiresAt: number;
}

/** Main-process, one-shot binding between a confirmation and the exact SQL text. */
export class SqlConfirmationStore {
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(private readonly ttlMS = DEFAULT_TTL_MS) {}

  issue(context: SqlConfirmationContext, now = Date.now()): string {
    this.prune(now);
    while (this.pending.size >= MAX_PENDING_CONFIRMATIONS) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (!oldest) break;
      this.pending.delete(oldest);
    }
    const token = randomUUID();
    this.pending.set(token, { digest: digestContext(context), expiresAt: now + this.ttlMS });
    return token;
  }

  consume(token: string | undefined, context: SqlConfirmationContext, now = Date.now()): boolean {
    if (!token) return false;
    const entry = this.pending.get(token);
    this.pending.delete(token);
    if (!entry || entry.expiresAt < now) return false;
    return entry.digest === digestContext(context);
  }

  get size(): number {
    return this.pending.size;
  }

  private prune(now: number): void {
    for (const [token, entry] of this.pending) {
      if (entry.expiresAt < now) this.pending.delete(token);
    }
  }
}

function digestContext(context: SqlConfirmationContext): string {
  return createHash('sha256')
    .update(context.connectionId)
    .update('\0')
    .update(context.database)
    .update('\0')
    .update(context.source)
    .digest('hex');
}
