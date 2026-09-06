import { describe, expect, it, vi } from 'vitest';
import { DatabaseRenameCoordinator } from '../../../src/main/database-rename/coordinator.js';
import type { RuntimeSupervisor } from '../../../src/main/runtime/supervisor.js';
import type { Database } from '../../../src/main/storage/database.js';
import type { DatabaseRenameProgressEvent } from '../../../src/shared/domain/index.js';

function localDatabase(defaultDatabase: string | null = 'source') {
  const renameDatabaseContext = vi.fn();
  const update = vi.fn();
  const byId = vi.fn(() => defaultDatabase === null ? null : ({
    id: 'connection',
    groupId: null,
    name: 'Connection',
    color: null,
    uriRedacted: 'mongodb://localhost',
    defaultDatabase,
    readOnly: false,
    options: {},
    hasSecret: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  const transaction = vi.fn((callback: () => void) => callback);
  return {
    database: {
      saved: { renameDatabaseContext },
      profiles: { byId, update },
      transaction,
    } as unknown as Database,
    renameDatabaseContext,
    update,
    transaction,
  };
}

function coordinatorWith(request: ReturnType<typeof vi.fn>, database = localDatabase()) {
  const trackDatabaseRenameProgress = vi.fn();
  const supervisor = {
    get: vi.fn(() => ({ request })),
    trackDatabaseRenameProgress,
  } as unknown as RuntimeSupervisor;
  const coordinator = new DatabaseRenameCoordinator(supervisor, () => database.database);
  return { coordinator, database, trackDatabaseRenameProgress };
}

function terminalEvent(coordinator: DatabaseRenameCoordinator): Promise<DatabaseRenameProgressEvent> {
  return new Promise((resolve) => {
    coordinator.on('progress', (event: DatabaseRenameProgressEvent) => {
      if (event.status === 'completed' || event.status === 'failed') resolve(event);
    });
  });
}

describe('database rename coordinator', () => {
  it('moves collections sequentially, disables move timeouts, then updates all local references', async () => {
    let activeMove = false;
    const request = vi.fn(async (
      type: string,
      payload: Record<string, unknown>,
      _options?: { timeoutMS?: number },
    ) => {
      if (type === 'database-rename-preflight') return { collections: ['alpha', 'beta', 'zeta'] };
      if (type === 'database-rename-move-collection') {
        expect(activeMove).toBe(false);
        activeMove = true;
        await Promise.resolve();
        activeMove = false;
        return { moved: true };
      }
      return undefined;
    });
    const { coordinator, database } = coordinatorWith(request);
    const completed = terminalEvent(coordinator);
    await coordinator.start({
      connectionId: 'connection', database: 'source', newDatabase: 'target',
    });

    await expect(completed).resolves.toMatchObject({
      status: 'completed',
      collectionCount: 3,
      movedCount: 3,
      movedCollections: ['alpha', 'beta', 'zeta'],
      remainingCollections: [],
    });
    const moves = request.mock.calls.filter(([type]) => type === 'database-rename-move-collection');
    expect(moves.map(([, payload]) => payload.collection)).toEqual(['alpha', 'beta', 'zeta']);
    expect(moves.every((call) => call[2]?.timeoutMS === 0)).toBe(true);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.renameDatabaseContext).toHaveBeenCalledWith('connection', 'source', 'target');
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({ defaultDatabase: 'target' }));
    expect(request).toHaveBeenLastCalledWith('data-transfer-unlock', expect.any(Object));
  });

  it('stops at the first move error, reports moved and remaining collections, and never updates local references', async () => {
    const request = vi.fn(async (type: string, payload: Record<string, unknown>) => {
      if (type === 'database-rename-preflight') return { collections: ['alpha', 'beta', 'gamma'] };
      if (type === 'database-rename-move-collection' && payload.collection === 'beta') {
        throw new Error('namespace collision');
      }
      return undefined;
    });
    const { coordinator, database } = coordinatorWith(request);
    const failed = terminalEvent(coordinator);
    await coordinator.start({
      connectionId: 'connection', database: 'source', newDatabase: 'target',
    });

    await expect(failed).resolves.toMatchObject({
      status: 'failed',
      movedCount: 1,
      movedCollections: ['alpha'],
      remainingCollections: ['beta', 'gamma'],
      message: expect.stringContaining('no rollback'),
    });
    const moves = request.mock.calls.filter(([type]) => type === 'database-rename-move-collection');
    expect(moves.map(([, payload]) => payload.collection)).toEqual(['alpha', 'beta']);
    expect(database.renameDatabaseContext).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it('does not move anything when preflight fails and emits a terminal failure', async () => {
    const request = vi.fn(async (type: string) => {
      if (type === 'database-rename-preflight') throw new Error('unsupported view');
      return undefined;
    });
    const { coordinator, database } = coordinatorWith(request);
    const failed = terminalEvent(coordinator);
    await coordinator.start({
      connectionId: 'connection', database: 'source', newDatabase: 'target',
    });
    await expect(failed).resolves.toMatchObject({
      status: 'failed', movedCount: 0, movedCollections: [], remainingCollections: [],
    });
    expect(request.mock.calls.some(([type]) => type === 'database-rename-move-collection')).toBe(false);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('holds a per-connection background lock until the job finishes', async () => {
    let releasePreflight!: (value: { collections: string[] }) => void;
    const preflight = new Promise<{ collections: string[] }>((resolve) => { releasePreflight = resolve; });
    const request = vi.fn(async (type: string) => {
      if (type === 'database-rename-preflight') return preflight;
      return undefined;
    });
    const { coordinator } = coordinatorWith(request);
    const completed = terminalEvent(coordinator);
    await coordinator.start({
      connectionId: 'connection', database: 'source', newDatabase: 'target',
    });
    expect(coordinator.isConnectionBusy('connection')).toBe(true);
    await expect(coordinator.start({
      connectionId: 'connection', database: 'source', newDatabase: 'other',
    })).rejects.toMatchObject({ category: 'Validation' });

    releasePreflight({ collections: ['items'] });
    await completed;
    expect(coordinator.isConnectionBusy('connection')).toBe(false);
  });
});
