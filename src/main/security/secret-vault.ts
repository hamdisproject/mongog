import { safeStorage } from 'electron';
import { appError } from '../../shared/errors/index.js';
import type { SecretsRepo } from '../storage/repositories/secrets.js';
import { MacKeychainSecretStore, type NativeSecretStore } from './mac-keychain-secret-store.js';

export type VaultStatus = 'available' | 'unavailable' | 'plain-text-fallback';

export interface VaultInfo {
  status: VaultStatus;
  backend?: string;
}

const ASYNC_ENVELOPE = Buffer.from('mongog:v1:async\0', 'utf8');
const SYNC_ENVELOPE = Buffer.from('mongog:v1:sync\0', 'utf8');
const MAC_KEYCHAIN_ENVELOPE = Buffer.from('mongog:v1:mac-keychain\0', 'utf8');

type CipherKind = 'async' | 'sync' | 'mac-keychain';

function wrapCiphertext(kind: CipherKind, ciphertext: Buffer): Buffer {
  const envelope = kind === 'async'
    ? ASYNC_ENVELOPE
    : kind === 'sync'
      ? SYNC_ENVELOPE
      : MAC_KEYCHAIN_ENVELOPE;
  return Buffer.concat([envelope, ciphertext]);
}

function unwrapCiphertext(blob: Buffer): { kind: CipherKind; ciphertext: Buffer; legacy: boolean } {
  if (blob.subarray(0, ASYNC_ENVELOPE.length).equals(ASYNC_ENVELOPE)) {
    return { kind: 'async', ciphertext: blob.subarray(ASYNC_ENVELOPE.length), legacy: false };
  }
  if (blob.subarray(0, SYNC_ENVELOPE.length).equals(SYNC_ENVELOPE)) {
    return { kind: 'sync', ciphertext: blob.subarray(SYNC_ENVELOPE.length), legacy: false };
  }
  if (blob.subarray(0, MAC_KEYCHAIN_ENVELOPE.length).equals(MAC_KEYCHAIN_ENVELOPE)) {
    return {
      kind: 'mac-keychain',
      ciphertext: blob.subarray(MAC_KEYCHAIN_ENVELOPE.length),
      legacy: false,
    };
  }

  // Blobs written before the envelope was introduced always used the async API.
  return { kind: 'async', ciphertext: blob, legacy: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SecretVault {
  private repo: SecretsRepo | null = null;
  private fallback = new Map<string, Buffer>();

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly nativeSecretStore: NativeSecretStore | null = platform === 'darwin'
      ? new MacKeychainSecretStore()
      : null,
  ) {}

  bind(repo: SecretsRepo): void {
    this.repo = repo;
  }

  private async getBlob(key: string): Promise<Buffer | null> {
    if (this.repo) return this.repo.getBlob(key);
    return this.fallback.get(key) ?? null;
  }

  private async setBlob(key: string, blob: Buffer): Promise<void> {
    if (this.repo) {
      this.repo.upsert(key, blob);
    } else {
      this.fallback.set(key, blob);
    }
  }

  private async deleteBlob(key: string): Promise<void> {
    if (this.repo) {
      this.repo.remove(key);
    } else {
      this.fallback.delete(key);
    }
  }

  private async hasBlob(key: string): Promise<boolean> {
    if (this.repo) return this.repo.has(key);
    return this.fallback.has(key);
  }

  async info(): Promise<VaultInfo> {
    let asyncAvailable = false;
    try {
      asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      asyncAvailable = false;
    }
    let backend: string | undefined;
    if (this.platform === 'linux') {
      try {
        backend = safeStorage.getSelectedStorageBackend();
      } catch {
        backend = 'unknown';
      }
    }

    const syncAvailable = this.canUseSynchronousFallback() && safeStorage.isEncryptionAvailable();
    return {
      status: backend === 'basic_text'
        ? 'plain-text-fallback'
        : asyncAvailable || syncAvailable || this.nativeSecretStore !== null
          ? 'available'
          : 'unavailable',
      ...(backend !== undefined ? { backend } : {}),
    };
  }

  async set(key: string, plaintext: string): Promise<void> {
    try {
      const previous = await this.getBlob(key);
      if (previous && unwrapCiphertext(previous).kind === 'mac-keychain') {
        if (!this.nativeSecretStore) throw new Error('The macOS Keychain integration is unavailable.');
        await this.nativeSecretStore.set(key, plaintext);
        return;
      }

      const encrypted = await this.encrypt(key, plaintext);
      try {
        await this.setBlob(key, encrypted);
      } catch (error) {
        if (unwrapCiphertext(encrypted).kind === 'mac-keychain') {
          await this.nativeSecretStore?.delete(key).catch(() => undefined);
        }
        throw error;
      }
    } catch (err) {
      throw appError('SecureStorageFailure', this.secureStorageError('encrypt', err));
    }
  }

  async get(key: string): Promise<string | null> {
    const blob = await this.getBlob(key);
    if (!blob) return null;
    try {
      const envelope = unwrapCiphertext(blob);
      if (envelope.kind === 'mac-keychain') {
        if (!this.nativeSecretStore) throw new Error('The macOS Keychain integration is unavailable.');
        const result = await this.nativeSecretStore.get(key);
        if (result === null) throw new Error('The macOS Keychain item is missing.');
        return result;
      }
      if (envelope.kind === 'sync') {
        return safeStorage.decryptString(envelope.ciphertext);
      }

      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new Error('The operating-system asynchronous credential store is unavailable.');
      }
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(envelope.ciphertext);
      if (shouldReEncrypt || envelope.legacy) await this.setBlob(key, await this.encrypt(key, result));
      return result;
    } catch (err) {
      throw appError('SecureStorageFailure', this.secureStorageError('decrypt', err));
    }
  }

  async clear(key: string): Promise<void> {
    const blob = await this.getBlob(key);
    if (blob && unwrapCiphertext(blob).kind === 'mac-keychain') {
      await this.nativeSecretStore?.delete(key);
    }
    await this.deleteBlob(key);
  }

  async has(key: string): Promise<boolean> {
    return this.hasBlob(key);
  }

  private canUseSynchronousFallback(): boolean {
    // macOS Keychain and Windows DPAPI remain encrypted at rest. Linux's
    // synchronous basic_text backend is intentionally never accepted.
    return this.platform === 'darwin' || this.platform === 'win32';
  }

  private async encrypt(key: string, plaintext: string): Promise<Buffer> {
    let asyncFailure: unknown = null;
    let syncFailure: unknown = null;
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        return wrapCiphertext('async', await safeStorage.encryptStringAsync(plaintext));
      }
      asyncFailure = new Error('The operating-system asynchronous credential store is unavailable.');
    } catch (error) {
      asyncFailure = error;
    }

    if (this.canUseSynchronousFallback()) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return wrapCiphertext('sync', safeStorage.encryptString(plaintext));
        }
      } catch (error) {
        syncFailure = error;
      }
    }

    if (this.nativeSecretStore) {
      try {
        await this.nativeSecretStore.set(key, plaintext);
        return wrapCiphertext('mac-keychain', Buffer.alloc(0));
      } catch (nativeError) {
        throw new Error(
          `Asynchronous storage failed (${errorMessage(asyncFailure)}); `
          + `secure synchronous storage failed (${errorMessage(syncFailure)}); `
          + `macOS Keychain fallback failed (${errorMessage(nativeError)}).`,
        );
      }
    }

    throw asyncFailure instanceof Error
      ? asyncFailure
      : new Error('The operating-system credential store is unavailable.');
  }

  private secureStorageError(operation: 'encrypt' | 'decrypt', error: unknown): string {
    const action = operation === 'encrypt' ? 'encrypt' : 'decrypt';
    const guidance = this.platform === 'darwin'
      ? ' Unlock the macOS login keychain, allow MongoG access when prompted, and try again.'
      : '';
    return `Failed to ${action} secret: ${errorMessage(error)}.${guidance}`;
  }
}

export const secretVault = new SecretVault();
