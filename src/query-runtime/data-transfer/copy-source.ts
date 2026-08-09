import { randomUUID } from 'node:crypto';
import { EJSON } from 'bson';
import type { FindCursor, MongoClient, Document } from 'mongodb';
import { parseQueryDocumentExpression } from '../collection/operations.js';
import { appError } from '../../shared/errors/index.js';
import { TRANSFER_MAX_BATCH_BYTES, TRANSFER_MAX_BATCH_DOCUMENTS } from './write.js';

interface SourceCursorState {
  cursor: FindCursor<Document>;
  pending?: { ejson: string; bytes: number };
}

export interface SourceMetadata {
  collectionInfoEjson?: string;
  indexesEjson: string[];
}

/**
 * Deliberately read-only transfer surface. No target write or source mutation
 * method exists in this class or in its runtime request protocol.
 */
export class CopySourceManager {
  private readonly cursors = new Map<string, SourceCursorState>();

  async preview(
    client: MongoClient,
    database: string,
    collection: string,
    filterSource: string,
  ): Promise<{ documents: string[]; truncated: boolean }> {
    const filter = parseQueryDocumentExpression(filterSource, 'Transfer filter');
    const cursor = client.db(database).collection(collection).find(filter, {
      limit: 21,
      maxTimeMS: 30_000,
    });
    const documents: string[] = [];
    try {
      for (;;) {
        const document = await cursor.next();
        if (!document) break;
        documents.push(canonical(document));
        if (documents.length >= 21) break;
      }
    } finally {
      await cursor.close().catch(() => undefined);
    }
    return { documents: documents.slice(0, 20), truncated: documents.length > 20 };
  }

  async count(
    client: MongoClient,
    database: string,
    collection: string,
    filterSource: string,
  ): Promise<{ count: number }> {
    const filter = parseQueryDocumentExpression(filterSource, 'Transfer filter');
    return {
      count: await client.db(database).collection(collection).countDocuments(filter, {
        maxTimeMS: 110_000,
      }),
    };
  }

  async metadata(client: MongoClient, database: string, collection: string): Promise<SourceMetadata> {
    const infoCursor = client.db(database).listCollections({ name: collection });
    let info: Document | null = null;
    try {
      info = await infoCursor.next();
    } finally {
      await infoCursor.close().catch(() => undefined);
    }
    if (!info) throw appError('NotFound', `Source collection no longer exists: ${database}.${collection}`);

    const indexes: string[] = [];
    const indexCursor = client.db(database).collection(collection).listIndexes();
    try {
      for (;;) {
        const index = await indexCursor.next();
        if (!index) break;
        indexes.push(canonical(index));
      }
    } finally {
      await indexCursor.close().catch(() => undefined);
    }
    return { collectionInfoEjson: canonical(info), indexesEjson: indexes };
  }

  open(
    client: MongoClient,
    database: string,
    collection: string,
    filterSource: string,
  ): { cursorId: string } {
    const filter = parseQueryDocumentExpression(filterSource, 'Transfer filter');
    const cursorId = randomUUID();
    this.cursors.set(cursorId, {
      cursor: client.db(database).collection(collection).find(filter, {
        batchSize: 100,
        maxTimeMS: 110_000,
      }),
    });
    return { cursorId };
  }

  async next(cursorId: string): Promise<{ documentsEjson: string[]; hasMore: boolean; bytes: number }> {
    const state = this.cursors.get(cursorId);
    if (!state) throw appError('NotFound', 'Transfer source cursor has expired.');
    const values: string[] = [];
    let bytes = 0;

    for (;;) {
      let item = state.pending;
      state.pending = undefined;
      if (!item) {
        const document = await state.cursor.next();
        if (!document) {
          await this.close(cursorId);
          return { documentsEjson: values, hasMore: false, bytes };
        }
        const ejson = canonical(document);
        item = { ejson, bytes: Buffer.byteLength(ejson) };
      }

      if (item.bytes > TRANSFER_MAX_BATCH_BYTES) {
        await this.close(cursorId);
        throw appError('Validation', 'A source document exceeds the 8 MiB transfer batch limit.');
      }
      if (
        values.length > 0 &&
        (values.length >= TRANSFER_MAX_BATCH_DOCUMENTS || bytes + item.bytes > TRANSFER_MAX_BATCH_BYTES)
      ) {
        state.pending = item;
        return { documentsEjson: values, hasMore: true, bytes };
      }
      values.push(item.ejson);
      bytes += item.bytes;
      if (values.length >= TRANSFER_MAX_BATCH_DOCUMENTS) {
        return { documentsEjson: values, hasMore: true, bytes };
      }
    }
  }

  async close(cursorId: string): Promise<void> {
    const state = this.cursors.get(cursorId);
    this.cursors.delete(cursorId);
    if (state) await state.cursor.close().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.cursors.keys()].map((id) => this.close(id)));
  }
}

function canonical(value: unknown): string {
  return EJSON.stringify(value, undefined, 0, { relaxed: false });
}
