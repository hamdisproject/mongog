import { describe, expect, it, vi } from 'vitest';
import { mockSupervisor, useConnectionManagerHarness } from './helpers/connection-manager.js';

const harness = useConnectionManagerHarness();

describe('groups', () => {
  it('creates, lists, and deletes groups', async () => {
    const mgr = harness.createManager();
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
    const mgr = harness.createManager();
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
    const mgr = harness.createManager();
    await expect(
      mgr.createProfile({
        name: 'Bad',
        uri: 'mongodb://user:pass@localhost:27017',
      }),
    ).rejects.toThrow('URI contains credentials');
  });

  it('creates a profile with secret', async () => {
    const mgr = harness.createManager();
    const p = await mgr.createProfile({
      name: 'WithSecret',
      uri: 'mongodb://localhost:27017/admin',
      secret: { password: 's3cret' },
    });
    expect(p.hasSecret).toBe(true);
    expect(p.uriRedacted).not.toContain('s3cret');
    expect([...harness.secretStore.values.values()].join('')).toContain('s3cret');
  });

  it('does not persist a profile when secure storage fails', async () => {
    const mgr = harness.createManager();
    vi.spyOn(harness.secretStore, 'set').mockRejectedValueOnce(new Error('vault unavailable'));

    await expect(mgr.createProfile({
      name: 'Unsafe',
      uri: 'mongodb://localhost:27017',
      secret: { password: 'must-not-persist' },
    })).rejects.toThrow('vault unavailable');

    expect(mgr.listProfiles()).toHaveLength(0);
  });

  it('updates a profile', async () => {
    const mgr = harness.createManager();
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
    const mgr = harness.createManager();
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
    expect(harness.secretStore.values.size).toBe(0);
  });

  it('deletes a profile and disconnects runtime', async () => {
    const mgr = harness.createManager();
    const p = await mgr.createProfile({
      name: 'ToDelete',
      uri: 'mongodb://localhost:27017',
      secret: { password: 'delete-me' },
    });
    await mgr.deleteProfile(p.id);
    expect(mgr.getProfile(p.id)).toBeNull();
    expect(harness.secretStore.values.size).toBe(0);
    expect(mockSupervisor.dispose).toHaveBeenCalledWith(p.id);
  });
});
