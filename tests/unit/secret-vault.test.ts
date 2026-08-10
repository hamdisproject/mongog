import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretsRepo } from '../../src/main/storage/repositories/secrets.js';

const safeStorageMock = vi.hoisted(() => ({
  available: true,
  syncAvailable: true,
  failAsyncEncryption: false,
  reEncrypt: false,
  encryptStringAsync: vi.fn(async (plaintext: string) => {
    if (safeStorageMock.failAsyncEncryption) throw new Error('async keychain denied');
    return Buffer.from(`cipher:${Buffer.from(plaintext).toString('base64')}`);
  }),
  decryptStringAsync: vi.fn(async (blob: Buffer) => ({
    result: Buffer.from(blob.toString().slice('cipher:'.length), 'base64').toString(),
    shouldReEncrypt: safeStorageMock.reEncrypt,
  })),
  isAsyncEncryptionAvailable: vi.fn(async () => safeStorageMock.available),
  isEncryptionAvailable: vi.fn(() => safeStorageMock.syncAvailable),
  encryptString: vi.fn((plaintext: string) => (
    Buffer.from(`sync-cipher:${Buffer.from(plaintext).toString('base64')}`)
  )),
  decryptString: vi.fn((blob: Buffer) => (
    Buffer.from(blob.toString().slice('sync-cipher:'.length), 'base64').toString()
  )),
  getSelectedStorageBackend: vi.fn(() => 'keychain'),
}));

vi.mock('electron', () => ({ safeStorage: safeStorageMock }));

import { SecretVault } from '../../src/main/security/secret-vault.js';
import type { NativeSecretStore } from '../../src/main/security/mac-keychain-secret-store.js';

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

class MemoryNativeSecretStore implements NativeSecretStore {
  readonly values = new Map<string, string>();

  async set(key: string, plaintext: string): Promise<void> {
    this.values.set(key, plaintext);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('SecretVault', () => {
  beforeEach(() => {
    safeStorageMock.available = true;
    safeStorageMock.syncAvailable = true;
    safeStorageMock.failAsyncEncryption = false;
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

  it('uses the encrypted OS fallback on macOS when async Keychain encryption is denied', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault('darwin');
    vault.bind(repo as unknown as SecretsRepo);
    safeStorageMock.failAsyncEncryption = true;

    await vault.set('conn:1', 'fallback-secret');

    const persisted = repo.blobs.get('conn:1');
    expect(persisted).toBeDefined();
    expect(persisted!.toString()).not.toContain('fallback-secret');
    expect(persisted!.subarray(0, 'mongog:v1:sync\0'.length).toString()).toBe('mongog:v1:sync\0');
    expect(await vault.get('conn:1')).toBe('fallback-secret');
    expect(safeStorageMock.encryptString).toHaveBeenCalledTimes(1);
  });

  it('stores only a locator in SQLite when Electron Keychain access is denied', async () => {
    const repo = new MemorySecretsRepo();
    const nativeStore = new MemoryNativeSecretStore();
    const vault = new SecretVault('darwin', nativeStore);
    vault.bind(repo as unknown as SecretsRepo);
    safeStorageMock.failAsyncEncryption = true;
    safeStorageMock.syncAvailable = false;

    await vault.set('conn:1', 'native-keychain-secret');

    expect(repo.blobs.get('conn:1')!.toString()).toBe('mongog:v1:mac-keychain\0');
    expect(repo.blobs.get('conn:1')!.toString()).not.toContain('native-keychain-secret');
    expect(nativeStore.values.get('conn:1')).toBe('native-keychain-secret');
    expect(await vault.get('conn:1')).toBe('native-keychain-secret');

    await vault.clear('conn:1');
    expect(nativeStore.values.has('conn:1')).toBe(false);
  });

  it('never falls back to synchronous basic-text storage on Linux', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault('linux');
    vault.bind(repo as unknown as SecretsRepo);
    safeStorageMock.failAsyncEncryption = true;

    await expect(vault.set('conn:1', 'must-not-persist')).rejects.toMatchObject({
      category: 'SecureStorageFailure',
    });
    expect(repo.blobs.has('conn:1')).toBe(false);
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled();
  });

  it('reads and upgrades legacy unversioned async ciphertext', async () => {
    const repo = new MemorySecretsRepo();
    const vault = new SecretVault('darwin');
    vault.bind(repo as unknown as SecretsRepo);
    repo.upsert('conn:legacy', Buffer.from(`cipher:${Buffer.from('legacy-secret').toString('base64')}`));

    expect(await vault.get('conn:legacy')).toBe('legacy-secret');
    expect(repo.blobs.get('conn:legacy')!.subarray(0, 'mongog:v1:async\0'.length).toString())
      .toBe('mongog:v1:async\0');
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
