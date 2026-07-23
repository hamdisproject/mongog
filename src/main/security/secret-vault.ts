import { safeStorage } from 'electron';
import { appError } from '../../shared/errors/index.js';
import type { SecretsRepo } from '../storage/repositories/secrets.js';

export type VaultStatus = 'available' | 'unavailable' | 'plain-text-fallback';

export interface VaultInfo {
  status: VaultStatus;
  backend?: string;
}

export class SecretVault {
  private repo: SecretsRepo | null = null;
  private fallback = new Map<string, Buffer>();

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
    const available = await safeStorage.isAsyncEncryptionAvailable();
    let backend: string | undefined;
    if (process.platform === 'linux') {
      try {
        backend = safeStorage.getSelectedStorageBackend();
      } catch {
        backend = 'unknown';
      }
    }
    return {
      status: !available ? 'unavailable' : backend === 'basic_text' ? 'plain-text-fallback' : 'available',
      ...(backend !== undefined ? { backend } : {}),
    };
  }

  async set(key: string, plaintext: string): Promise<void> {
    try {
      await this.setBlob(key, await safeStorage.encryptStringAsync(plaintext));
    } catch (err) {
      throw appError('SecureStorageFailure', `Failed to encrypt secret: ${(err as Error).message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    const blob = await this.getBlob(key);
    if (!blob) return null;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(blob);
      if (shouldReEncrypt) {
        await this.setBlob(key, await safeStorage.encryptStringAsync(result));
      }
      return result;
    } catch (err) {
      throw appError('SecureStorageFailure', `Failed to decrypt secret (needs re-auth?): ${(err as Error).message}`);
    }
  }

  async clear(key: string): Promise<void> {
    await this.deleteBlob(key);
  }

  async has(key: string): Promise<boolean> {
    return this.hasBlob(key);
  }
}

export const secretVault = new SecretVault();
