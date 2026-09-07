import { describe, expect, it, vi } from 'vitest';
import { mockSupervisor, useConnectionManagerHarness } from './helpers/connection-manager.js';

const harness = useConnectionManagerHarness();

describe('connectivity', () => {
  it('connect delegates to supervisor.ensure', async () => {
    const mgr = harness.createManager();
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
    const mgr = harness.createManager();
    const p = await mgr.createProfile({ name: 'Disc', uri: 'mongodb://localhost:27017' });
    await mgr.disconnect(p.id);
    expect(mockSupervisor.dispose).toHaveBeenCalledWith(p.id);
  });

  it('resolves URI without secret', async () => {
    const mgr = harness.createManager();
    const p = await mgr.createProfile({
      name: 'NoSecret',
      uri: 'mongodb://host1:27017/test',
    });
    const uri = await mgr.resolveUri(p.id);
    expect(uri).toBe('mongodb://host1:27017/test');
  });

  it('resolves URI with secret password injection', async () => {
    const mgr = harness.createManager();
    const p = await mgr.createProfile({
      name: 'WithPass',
      uri: 'mongodb://host2:27017/admin',
      secret: { password: 'my-pass' },
    });
    const uri = await mgr.resolveUri(p.id);
    expect(uri).toContain('my-pass@host2');
  });

  it('resolves URI with uriOverride', async () => {
    const mgr = harness.createManager();
    const p = await mgr.createProfile({
      name: 'Override',
      uri: 'mongodb://host3:27017',
      secret: { uriOverride: 'mongodb://real-host:27017/admin' },
    });
    const uri = await mgr.resolveUri(p.id);
    expect(uri).toBe('mongodb://real-host:27017/admin');
  });

  it('lists connected profiles', async () => {
    const mgr = harness.createManager();
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
    const mgr = harness.createManager();
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
