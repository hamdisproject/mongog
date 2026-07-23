import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretsRepo } from '../../src/main/storage/repositories/secrets.js';

const safeStorageMock = vi.hoisted(() => ({
  available: true,
  reEncrypt: false,
  encryptStringAsync: vi.fn(async (plaintext: string) => (
    Buffer.from(`cipher:${Buffer.from(plaintext).toString('base64')}`)
  )),
  decryptStringAsync: vi.fn(async (blob: Buffer) => ({
    result: Buffer.from(blob.toString().slice('cipher:'.length), 'base64').toString(),
    shouldReEncrypt: safeStorageMock.reEncrypt,
  })),
  isAsyncEncryptionAvailable: vi.fn(async () => safeStorageMock.available),
  getSelectedStorageBackend: vi.fn(() => 'keychain'),
}));

vi.mock('electron', () => ({ safeStorage: safeStorageMock }));

import { SecretVault } from '../../src/main/security/secret-vault.js';

class MemorySecretsRepo {
  readonly blobs = new Map<string, Buffer>();

  getBlob(key: string): Buffer | null {
    return this.blobs.get(key) ?? null;
  }

  upsert(key: string, blob: Buffer): void {
    this.blobs.set(key, blob);
  }

  remove(key: string): void {
    this.blobs.delete(key);
  }

  has(key: string): boolean {
    return this.blobs.has(key);
  }
}

describe('SecretVault', () => {
  beforeEach(() => {
    safeStorageMock.available = true;
    safeStorageMock.reEncrypt = false;
    vi.clearAllMocks();
  });

  it('stores only encrypted blobs and decrypts on demand', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault();
    vault.bind(repo as unknown as SecretsRepo);

    await vault.set('conn:1', '{"password":"s3cret"}');

    const persisted = repo.blobs.get('conn:1');
    expect(persisted).toBeDefined();
    expect(persisted!.toString()).not.toContain('s3cret');
    expect(await vault.get('conn:1')).toBe('{"password":"s3cret"}');
  });

  it('transparently rotates blobs when the backend requests re-encryption', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault();
    vault.bind(repo as unknown as SecretsRepo);
    await vault.set('conn:1', 'rotate-me');

    safeStorageMock.reEncrypt = true;
    await vault.get('conn:1');

    expect(safeStorageMock.encryptStringAsync).toHaveBeenCalledTimes(2);
    expect(repo.blobs.get('conn:1')!.toString()).not.toContain('rotate-me');
  });

  it('clears persisted credentials', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault();
    vault.bind(repo as unknown as SecretsRepo);
    await vault.set('conn:1', 'temporary');

    await vault.clear('conn:1');

    expect(await vault.has('conn:1')).toBe(false);
    expect(await vault.get('conn:1')).toBeNull();
  });
});
