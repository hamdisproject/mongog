import { spawn } from 'node:child_process';

const SECURITY_BINARY = '/usr/bin/security';
const SERVICE = 'com.mongog.desktop.secrets';
const COMMAND_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface SecurityResult {
  code: number;
  stdout: Buffer;
}

export interface NativeSecretStore {
  set(key: string, plaintext: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

function runSecurity(args: string[], stdin = ''): Promise<SecurityResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY_BINARY, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('macOS Keychain operation timed out.')));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new Error('macOS Keychain returned an invalid oversized response.')));
        return;
      }
      stdout.push(chunk);
    });
    // Consume stderr so the child cannot block. It is deliberately never
    // included in errors because credential-manager output must stay private.
    child.stderr.resume();
    child.once('error', () => {
      finish(() => reject(new Error('Could not start the macOS Keychain service.')));
    });
    child.once('close', (code) => {
      finish(() => resolve({ code: code ?? -1, stdout: Buffer.concat(stdout) }));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin, 'utf8');
  });
}

function decodeSecret(output: Buffer): string {
  const encoded = output.toString('utf8').replace(/\r?\n$/, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('macOS Keychain returned malformed secret data.');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) {
    throw new Error('macOS Keychain returned malformed secret data.');
  }
  return decoded.toString('utf8');
}

/**
 * Direct macOS Keychain fallback for ad-hoc local packages where Chromium's
 * shared Safe Storage key is rejected by its code-signing access control.
 * Secret bytes travel only through a child-process pipe, never argv or logs.
 */
export class MacKeychainSecretStore implements NativeSecretStore {
  async set(key: string, plaintext: string): Promise<void> {
    const encoded = Buffer.from(plaintext, 'utf8').toString('base64');
    const result = await runSecurity(
      ['add-generic-password', '-a', key, '-s', SERVICE, '-U', '-w'],
      `${encoded}\n${encoded}\n`,
    );
    if (result.code !== 0) throw new Error('macOS Keychain rejected the secret update.');
  }

  async get(key: string): Promise<string | null> {
    const result = await runSecurity(['find-generic-password', '-a', key, '-s', SERVICE, '-w']);
    if (result.code === 44) return null;
    if (result.code !== 0) throw new Error('macOS Keychain rejected secret access.');
    return decodeSecret(result.stdout);
  }

  async delete(key: string): Promise<void> {
    const result = await runSecurity(['delete-generic-password', '-a', key, '-s', SERVICE]);
    if (result.code !== 0 && result.code !== 44) {
      throw new Error('macOS Keychain rejected secret deletion.');
    }
  }
}
