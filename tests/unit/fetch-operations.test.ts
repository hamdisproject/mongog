import { describe, expect, it, vi } from 'vitest';
import { FetchOperationRegistry } from '../../src/query-runtime/registry/fetch-operations.js';

describe('fetch operation registry', () => {
  it('aborts an active operation and cancels its attached resource', async () => {
    const registry = new FetchOperationRegistry();
    const cancelResource = vi.fn();
    const signal = registry.begin('operation-1');
    registry.attachResource('operation-1', cancelResource);

    await expect(registry.cancel('operation-1')).resolves.toBe(true);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe('MongoGCancelled');
    expect(cancelResource).toHaveBeenCalledOnce();
  });

  it('closes a resource attached after cancellation', async () => {
    const registry = new FetchOperationRegistry();
    const cancelResource = vi.fn();
    registry.begin('operation-2');

    await expect(registry.cancel('operation-2')).resolves.toBe(true);
    registry.attachResource('operation-2', cancelResource);
    await Promise.resolve();

    expect(cancelResource).toHaveBeenCalledOnce();
  });

  it('is idempotent while active and harmless after completion', async () => {
    const registry = new FetchOperationRegistry();
    const cancelResource = vi.fn();
    registry.begin('operation-3');
    registry.attachResource('operation-3', cancelResource);

    await expect(registry.cancel('operation-3')).resolves.toBe(true);
    await expect(registry.cancel('operation-3')).resolves.toBe(true);
    expect(cancelResource).toHaveBeenCalledOnce();

    registry.finish('operation-3');
    await expect(registry.cancel('operation-3')).resolves.toBe(false);
  });

  it('rejects duplicate active operation ids and disposes all resources', async () => {
    const registry = new FetchOperationRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.begin('operation-4');
    registry.attachResource('operation-4', first);
    expect(() => registry.begin('operation-4')).toThrow(/already active/i);
    registry.begin('operation-5');
    registry.attachResource('operation-5', second);

    await registry.dispose();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    await expect(registry.cancel('operation-4')).resolves.toBe(false);
  });
});
