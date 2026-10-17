import { describe, expect, it } from 'vitest';
import { IpcChannels } from '../../../src/shared/ipc/index.js';

describe('IPC surface', () => {
  it('exposes no Phase 0 spike channels or connection-less cursor/execution channels', () => {
    const legacy = Object.values(IpcChannels).filter((channel) => /^mongog:(spike|cursor|execution):/.test(channel));
    expect(legacy).toEqual([]);
  });
});
