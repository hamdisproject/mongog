import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  DatabaseRenameProgressEvent,
  DatabaseRenameStartResult,
  StartDatabaseRenameInput,
} from '../../shared/domain/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';
import type { DatabaseRenameManifest } from '../../query-runtime/database/operations.js';
import type { RuntimeSupervisor } from '../runtime/supervisor.js';
import type { Database } from '../storage/database.js';

interface ActiveRename {
  jobId: string;
  connectionId: string;
}

export class DatabaseRenameCoordinator extends EventEmitter {
  private readonly activeByConnection = new Map<string, ActiveRename>();

  constructor(
    private readonly supervisor: RuntimeSupervisor,
    private readonly getDb: () => Database,
  ) {
    super();
  }

  isConnectionBusy(connectionId: string): boolean {
    return this.activeByConnection.has(connectionId);
  }

  assertConnectionAvailable(connectionId: string): void {
    if (this.isConnectionBusy(connectionId)) {
      throw appError('Validation', 'A database rename is already using this connection.');
    }
  }

  async start(input: StartDatabaseRenameInput): Promise<DatabaseRenameStartResult> {
    this.assertConnectionAvailable(input.connectionId);
    const runtime = this.supervisor.get(input.connectionId);
    if (!runtime) throw appError('UtilityProcessCrash', 'Query runtime is not running.');
    const jobId = randomUUID();
    this.activeByConnection.set(input.connectionId, { jobId, connectionId: input.connectionId });
    try {
      await runtime.request('data-transfer-lock', { jobId });
    } catch (error) {
      this.activeByConnection.delete(input.connectionId);
      throw error;
    }
    this.publish({
      jobId,
      connectionId: input.connectionId,
      sourceDatabase: input.database,
      targetDatabase: input.newDatabase,
      status: 'queued',
      collectionCount: 0,
      movedCount: 0,
      message: 'Database rename queued.',
    });
    void this.run(jobId, input, runtime);
    return { jobId };
  }

  dispose(): void {
    this.activeByConnection.clear();
  }

  private async run(
    jobId: string,
    input: StartDatabaseRenameInput,
    runtime: NonNullable<ReturnType<RuntimeSupervisor['get']>>,
  ): Promise<void> {
    let collections: string[] = [];
    const movedCollections: string[] = [];
    let currentCollection: string | undefined;
    let terminalEvent: DatabaseRenameProgressEvent | null = null;
    try {
      this.publish({
        jobId,
        connectionId: input.connectionId,
        sourceDatabase: input.database,
        targetDatabase: input.newDatabase,
        status: 'preparing',
        collectionCount: 0,
        movedCount: 0,
        message: 'Checking database compatibility and target availability…',
      });
      const manifest = await runtime.request<DatabaseRenameManifest>('database-rename-preflight', {
        jobId,
        database: input.database,
        newDatabase: input.newDatabase,
      });
      collections = manifest.collections;

      for (const collection of collections) {
        currentCollection = collection;
        this.publish({
          jobId,
          connectionId: input.connectionId,
          sourceDatabase: input.database,
          targetDatabase: input.newDatabase,
          status: 'running',
          collectionCount: collections.length,
          movedCount: movedCollections.length,
          currentCollection: collection,
          message: `Moving ${collection}…`,
        });
        await runtime.request('database-rename-move-collection', {
          jobId,
          database: input.database,
          newDatabase: input.newDatabase,
          collection,
        }, { timeoutMS: 0 });
        movedCollections.push(collection);
      }

      const warning = this.updateLocalReferences(input);
      terminalEvent = {
        jobId,
        connectionId: input.connectionId,
        sourceDatabase: input.database,
        targetDatabase: input.newDatabase,
        status: 'completed',
        collectionCount: collections.length,
        movedCount: movedCollections.length,
        movedCollections: [...movedCollections],
        remainingCollections: [],
        message: `Database renamed to ${input.newDatabase}.`,
        ...(warning ? { warning } : {}),
      };
    } catch (error) {
      const safe = serializeError(error);
      terminalEvent = {
        jobId,
        connectionId: input.connectionId,
        sourceDatabase: input.database,
        targetDatabase: input.newDatabase,
        status: 'failed',
        collectionCount: collections.length,
        movedCount: movedCollections.length,
        movedCollections: [...movedCollections],
        remainingCollections: collections.slice(movedCollections.length),
        message: movedCollections.length > 0
          ? `${safe.message} ${movedCollections.length} collection(s) were moved; no rollback was attempted.`
          : safe.message,
        error: safe,
        ...(currentCollection ? { currentCollection } : {}),
      };
    } finally {
      await runtime.request('data-transfer-unlock', { jobId }).catch(() => undefined);
      if (this.activeByConnection.get(input.connectionId)?.jobId === jobId) {
        this.activeByConnection.delete(input.connectionId);
      }
      if (terminalEvent) this.publish(terminalEvent);
    }
  }

  private updateLocalReferences(input: StartDatabaseRenameInput): string | undefined {
    try {
      const database = this.getDb();
      database.transaction(() => {
        database.saved.renameDatabaseContext(input.connectionId, input.database, input.newDatabase);
        const profile = database.profiles.byId(input.connectionId);
        if (profile?.defaultDatabase === input.database) {
          database.profiles.update({ ...profile, defaultDatabase: input.newDatabase, updatedAt: Date.now() });
        }
      })();
      return undefined;
    } catch (error) {
      return `MongoDB rename completed, but local MongoG references could not be persisted: ${serializeError(error).message}`;
    }
  }

  private publish(event: DatabaseRenameProgressEvent): void {
    this.supervisor.trackDatabaseRenameProgress(event);
    this.emit('progress', event);
  }
}
