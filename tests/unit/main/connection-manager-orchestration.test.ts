import type { TestConnectionResult } from '../../../src/shared/domain/index.js';
import { describe, expect, it, vi } from 'vitest';
import { mockSupervisor, useConnectionManagerHarness } from './helpers/connection-manager.js';

const harness = useConnectionManagerHarness();

describe('draft validation and save/connect orchestration', () => {
  it('does not mutate persistence or the active runtime when draft testing fails', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({
      ok: false,
      error: { category: 'Authentication', message: 'Authentication failed' },
    }));
    const mgr = harness.createManager(tester);

    const result = await mgr.saveAndConnect(harness.draftRequest());
    expect(result).toMatchObject({ saved: false, connected: false });
    expect(mgr.listProfiles()).toHaveLength(0);
    expect(mockSupervisor.dispose).not.toHaveBeenCalled();
    expect(mockSupervisor.ensure).not.toHaveBeenCalled();
  });

  it('tests, saves, and connects a new profile without returning its password', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({
      ok: true, serverVersion: '8.0.0', topology: 'ReplicaSetWithPrimary', roundTripMs: 5,
    }));
    const mgr = harness.createManager(tester);

    const result = await mgr.saveAndConnect(harness.draftRequest());
    expect(result).toMatchObject({ saved: true, connected: true });
    expect(result.profile?.name).toBe('Draft');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(tester).toHaveBeenCalledWith(
      'mongodb://alice:secret@localhost:27017',
      { serverSelectionTimeoutMS: 5000 },
    );
    expect(mockSupervisor.ensure).toHaveBeenCalledWith(
      result.profile?.id,
      'mongodb://alice:secret@localhost:27017',
      { serverSelectionTimeoutMS: 5000 },
    );
  });

  it('exposes the isolated test and final connect as observable save-connect steps', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({ ok: true, roundTripMs: 4 }));
    const mgr = harness.createManager(tester);
    const calls: string[] = [];

    const result = await mgr.saveAndConnect(harness.draftRequest(), {
      test: async (operation) => {
        calls.push('test:start');
        const value = await operation();
        calls.push('test:end');
        return value;
      },
      connect: async (_profile, operation) => {
        calls.push('connect:start');
        await operation();
        calls.push('connect:end');
      },
    });

    expect(result).toMatchObject({ saved: true, connected: true });
    expect(calls).toEqual(['test:start', 'test:end', 'connect:start', 'connect:end']);
  });

  it('tests an edit with the stored secret before replacing its active runtime', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({ ok: true, roundTripMs: 2 }));
    const mgr = harness.createManager(tester);
    const profile = await mgr.createProfile({
      name: 'Existing', uri: 'mongodb://old-host:27017',
      options: { username: 'bob' }, secret: { password: 'old-password' },
    });
    const request = harness.draftRequest({
      profileId: profile.id,
      draft: {
        name: 'Updated', groupId: null, uri: 'mongodb://new-host:27017',
        defaultDatabase: null, readOnly: true, color: null,
        options: { username: 'bob' },
      },
      secretAction: { mode: 'preserve' },
    });

    const result = await mgr.saveAndConnect(request);
    expect(result).toMatchObject({ saved: true, connected: true, profile: { name: 'Updated', readOnly: true } });
    expect(tester).toHaveBeenCalledWith('mongodb://bob:old-password@new-host:27017', {});
    expect(await mgr.resolveUri(profile.id)).toBe('mongodb://bob:old-password@new-host:27017');
    expect(mockSupervisor.dispose).toHaveBeenCalledWith(profile.id);
  });

  it('supports explicit credential replacement and removal', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({ ok: true }));
    const mgr = harness.createManager(tester);
    const profile = await mgr.createProfile({
      name: 'Credentials', uri: 'mongodb://host:27017',
      options: { username: 'u' }, secret: { password: 'old' },
    });
    const base = harness.draftRequest({
      profileId: profile.id,
      draft: {
        name: 'Credentials', groupId: null, uri: 'mongodb://host:27017',
        defaultDatabase: null, readOnly: false, color: null, options: { username: 'u' },
      },
    });
    await mgr.saveAndConnect({ ...base, secretAction: { mode: 'replace', secret: { password: 'new' } } });
    expect(await mgr.resolveUri(profile.id)).toContain('u:new@host');

    await mgr.saveAndConnect({
      ...base,
      draft: { ...base.draft, options: {} },
      secretAction: { mode: 'clear' },
    });
    expect(await mgr.resolveUri(profile.id)).toBe('mongodb://host:27017');
    expect(harness.secretStore.values.size).toBe(0);
  });

  it('keeps a validated profile when the final connection loses a race', async () => {
    const tester = vi.fn(async (): Promise<TestConnectionResult> => ({ ok: true }));
    const mgr = harness.createManager(tester);
    mockSupervisor.ensure.mockRejectedValueOnce(new Error('server stopped'));

    const result = await mgr.saveAndConnect(harness.draftRequest());
    expect(result).toMatchObject({ saved: true, connected: false });
    expect(result.connectionError?.message).toContain('server stopped');
    expect(mgr.listProfiles()).toHaveLength(1);
  });
});
