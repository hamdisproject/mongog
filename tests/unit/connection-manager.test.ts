import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Database } from '../../src/main/storage/database.js';
import {
  ConnectionManager,
  type ConnectionSecretStore,
} from '../../src/main/services/connection-manager.js';
import type { RuntimeSupervisor } from '../../src/main/runtime/supervisor.js';

let tmpDir: string;
let dbPath: string;
let secretStore: MemorySecretStore;

class MemorySecretStore implements ConnectionSecretStore {
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

const mockSupervisor = {
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

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mongog-conn-mgr-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  dbPath = join(tmpDir, `conn-${Date.now()}.db`);
  secretStore = new MemorySecretStore();
  vi.clearAllMocks();
  mockSupervisor.get.mockReturnValue(null);
  mockSupervisor.getInfo.mockReturnValue(null);
});

function createManager(): ConnectionManager {
  const db = Database.openOrCreate(dbPath);
  return new ConnectionManager(db, mockSupervisor, secretStore);
}

describe('ConnectionManager', () => {
  describe('groups', () => {
    it('creates, lists, and deletes groups', async () => {
      const mgr = createManager();
      expect(mgr.listGroups()).toHaveLength(0);

      const g = mgr.createGroup('Production');
      expect(g.name).toBe('Production');
      expect(g.id).toBeTruthy();
      expect(mgr.listGroups()).toHaveLength(1);

      mgr.updateGroup({ ...g, name: 'Prod', collapsed: true, sortOrder: 1 });
      const updated = mgr.listGroups()[0]!;
      expect(updated.name).toBe('Prod');
      expect(updated.collapsed).toBe(true);

      const profile = await mgr.createProfile({
        name: 'Grouped',
        uri: 'mongodb://localhost:27017',
        groupId: g.id,
        secret: { password: 'keep-me' },
      });
      mgr.deleteGroup(g.id);
      expect(mgr.listGroups()).toHaveLength(0);
      expect(mgr.getProfile(profile.id)?.groupId).toBeNull();
      expect(await mgr.resolveUri(profile.id)).toContain('keep-me@localhost');
    });
  });

  describe('profiles', () => {
    it('creates a profile without secret', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'Local',
        uri: 'mongodb://localhost:27017',
        color: '#00ff00',
      });
      expect(p.name).toBe('Local');
      expect(p.uriRedacted).toBe('mongodb://localhost:27017');
      expect(p.hasSecret).toBe(false);

      const loaded = mgr.getProfile(p.id)!;
      expect(loaded).not.toBeNull();
      expect(loaded.name).toBe('Local');
    });

    it('rejects URI with embedded credentials', async () => {
      const mgr = createManager();
      await expect(
        mgr.createProfile({
          name: 'Bad',
          uri: 'mongodb://user:pass@localhost:27017',
        }),
      ).rejects.toThrow('URI contains credentials');
    });

    it('creates a profile with secret', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'WithSecret',
        uri: 'mongodb://localhost:27017/admin',
        secret: { password: 's3cret' },
      });
      expect(p.hasSecret).toBe(true);
      expect(p.uriRedacted).not.toContain('s3cret');
      expect([...secretStore.values.values()].join('')).toContain('s3cret');
    });

    it('does not persist a profile when secure storage fails', async () => {
      const mgr = createManager();
      vi.spyOn(secretStore, 'set').mockRejectedValueOnce(new Error('vault unavailable'));

      await expect(mgr.createProfile({
        name: 'Unsafe',
        uri: 'mongodb://localhost:27017',
        secret: { password: 'must-not-persist' },
      })).rejects.toThrow('vault unavailable');

      expect(mgr.listProfiles()).toHaveLength(0);
    });

    it('updates a profile', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'Original',
        uri: 'mongodb://localhost:27017',
      });
      const updated = await mgr.updateProfile(p.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');

      const loaded = mgr.getProfile(p.id)!;
      expect(loaded.name).toBe('Updated');
    });

    it('updates and clears a stored secret consistently', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'Rotating',
        uri: 'mongodb://localhost:27017',
        secret: { password: 'old' },
      });

      const updated = await mgr.updateProfile(p.id, { secret: { password: 'new' } });
      expect(updated.hasSecret).toBe(true);
      expect(await mgr.resolveUri(p.id)).toContain('new@localhost');

      const cleared = await mgr.updateProfile(p.id, { secret: null });
      expect(cleared.hasSecret).toBe(false);
      expect(await mgr.resolveUri(p.id)).toBe('mongodb://localhost:27017');
      expect(secretStore.values.size).toBe(0);
    });

    it('deletes a profile and disconnects runtime', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'ToDelete',
        uri: 'mongodb://localhost:27017',
        secret: { password: 'delete-me' },
      });
      await mgr.deleteProfile(p.id);
      expect(mgr.getProfile(p.id)).toBeNull();
      expect(secretStore.values.size).toBe(0);
      expect(mockSupervisor.dispose).toHaveBeenCalledWith(p.id);
    });
  });

  describe('connectivity', () => {
    it('connect delegates to supervisor.ensure', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'Conn',
        uri: 'mongodb://localhost:27017',
      });
      await mgr.connect(p.id);
      expect(mockSupervisor.ensure).toHaveBeenCalledWith(
        p.id,
        'mongodb://localhost:27017',
        {},
      );
    });

    it('disconnect delegates to supervisor.dispose', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({ name: 'Disc', uri: 'mongodb://localhost:27017' });
      await mgr.disconnect(p.id);
      expect(mockSupervisor.dispose).toHaveBeenCalledWith(p.id);
    });

    it('resolves URI without secret', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'NoSecret',
        uri: 'mongodb://host1:27017/test',
      });
      const uri = await mgr.resolveUri(p.id);
      expect(uri).toBe('mongodb://host1:27017/test');
    });

    it('resolves URI with secret password injection', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'WithPass',
        uri: 'mongodb://host2:27017/admin',
        secret: { password: 'my-pass' },
      });
      const uri = await mgr.resolveUri(p.id);
      expect(uri).toContain('my-pass@host2');
    });

    it('resolves URI with uriOverride', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({
        name: 'Override',
        uri: 'mongodb://host3:27017',
        secret: { uriOverride: 'mongodb://real-host:27017/admin' },
      });
      const uri = await mgr.resolveUri(p.id);
      expect(uri).toBe('mongodb://real-host:27017/admin');
    });

    it('lists connected profiles', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({ name: 'C', uri: 'mongodb://h' });
      expect(mgr.listConnected()).toEqual([]);

      mockSupervisor.getInfo.mockReturnValue({
        pid: 123,
        serverVersion: '8.0.0',
        connectedAt: 100,
      });
      expect(mgr.listConnected()).toEqual([p.id]);
    });

    it('returns connection state', async () => {
      const mgr = createManager();
      const p = await mgr.createProfile({ name: 'S', uri: 'mongodb://h' });

      expect(mgr.getConnectionState(p.id)).toEqual({ status: 'disconnected' });

      mockSupervisor.getInfo.mockReturnValue({
        pid: 456,
        serverVersion: '8.0.0',
        connectedAt: 100,
      });
      const state = mgr.getConnectionState(p.id);
      expect(state.status).toBe('connected');
      expect(state.pid).toBe(456);
      expect(state.serverVersion).toBe('8.0.0');
    });
  });
});
