import { beforeEach, vi } from 'vitest';
import { Database } from '../../../../src/main/storage/database.js';
import {
  ConnectionManager,
  type ConnectionSecretStore,
  type ConnectionTester,
} from '../../../../src/main/services/connection-manager.js';
import type { RuntimeSupervisor } from '../../../../src/main/runtime/supervisor.js';
import type { ConnectionDraftRequest } from '../../../../src/shared/domain/index.js';
import { useTempDatabase } from './temp-database.js';

export class MemorySecretStore implements ConnectionSecretStore {
  readonly values = new Map<string, string>();

  async set(key: string, plaintext: string): Promise<void> {
    this.values.set(key, plaintext);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async clear(key: string): Promise<void> {
    this.values.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

export const mockSupervisor = {
  ensure: vi.fn().mockResolvedValue({}),
  dispose: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockReturnValue(null),
  getInfo: vi.fn().mockReturnValue(null),
  disposeAll: vi.fn().mockResolvedValue(undefined),
} as unknown as RuntimeSupervisor & {
  ensure: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
};

export interface ConnectionManagerHarness {
  readonly secretStore: MemorySecretStore;
  createManager(tester?: ConnectionTester | null): ConnectionManager;
  draftRequest(input?: Partial<ConnectionDraftRequest>): ConnectionDraftRequest;
}

export function useConnectionManagerHarness(): ConnectionManagerHarness {
  const database = useTempDatabase('mongog-conn-mgr-');
  let secretStore = new MemorySecretStore();

  beforeEach(() => {
    secretStore = new MemorySecretStore();
    vi.clearAllMocks();
    mockSupervisor.ensure.mockResolvedValue({});
    mockSupervisor.get.mockReturnValue(null);
    mockSupervisor.getInfo.mockReturnValue(null);
  });

  return {
    get secretStore() {
      return secretStore;
    },
    createManager(tester: ConnectionTester | null = null) {
      const db = Database.openOrCreate(database.path);
      return new ConnectionManager(db, mockSupervisor, secretStore, tester);
    },
    draftRequest(input: Partial<ConnectionDraftRequest> = {}) {
      return {
        draft: {
          name: 'Draft',
          groupId: null,
          uri: 'mongodb://localhost:27017',
          defaultDatabase: 'app',
          readOnly: false,
          color: '#4ec9b0',
          options: { username: 'alice', serverSelectionTimeoutMS: 5000 },
        },
        secretAction: { mode: 'replace', secret: { password: 'secret' } },
        ...input,
      };
    },
  };
}
