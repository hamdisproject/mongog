import { describe, expect, it } from 'vitest';
import { classifyError, isAppError, appError, serializeError } from '../../../src/shared/errors/index.js';

describe('classifyError', () => {
  it('maps duplicate key (11000) to DuplicateKey', () => {
    const err = { name: 'MongoServerError', message: 'E11000 duplicate key error', code: 11000 };
    expect(classifyError(err).category).toBe('DuplicateKey');
  });

  it('maps auth failure (18) to Authentication', () => {
    expect(classifyError({ name: 'MongoServerError', message: 'auth failed', code: 18 }).category).toBe('Authentication');
  });

  it('maps unauthorized (13) to Authorization', () => {
    expect(classifyError({ name: 'MongoServerError', message: 'not authorized', code: 13 }).category).toBe('Authorization');
  });

  it('maps validation (121) to Validation', () => {
    expect(classifyError({ name: 'MongoServerError', message: 'Document failed validation', code: 121 }).category).toBe('Validation');
  });

  it('maps server selection errors with DNS hint', () => {
    const e = classifyError({ name: 'MongoServerSelectionError', message: 'getaddrinfo ENOTFOUND bad.host' });
    expect(e.category).toBe('ServerSelection');
    expect(e.hint).toMatch(/DNS/i);
  });

  it('maps network DNS failures to Dns', () => {
    expect(classifyError({ name: 'MongoNetworkError', message: 'ENOTFOUND x' }).category).toBe('Dns');
  });

  it('maps TLS failures to Tls', () => {
    expect(classifyError({ name: 'MongoNetworkError', message: 'TLS handshake failed: certificate verify failed' }).category).toBe('Tls');
  });

  it('maps invalid connection strings', () => {
    expect(classifyError({ name: 'MongoParseError', message: 'Invalid connection string' }).category).toBe('InvalidConnectionString');
  });

  it('maps plain JS errors to JavaScriptRuntime', () => {
    expect(classifyError(new TypeError('x is not a function')).category).toBe('JavaScriptRuntime');
  });

  it('maps abort to Cancellation', () => {
    expect(classifyError({ name: 'AbortError', message: 'aborted' }).category).toBe('Cancellation');
  });

  it('preserves code, codeName and labels', () => {
    const e = classifyError({
      name: 'MongoServerError',
      message: 'm',
      code: 112,
      codeName: 'WriteConflict',
      errorLabels: ['TransientTransactionError'],
    });
    expect(e.code).toBe(112);
    expect(e.codeName).toBe('WriteConflict');
    expect(e.labels).toContain('TransientTransactionError');
  });

  it('isAppError round-trips', () => {
    const e = appError('ReadOnlyProtection', 'blocked');
    expect(isAppError(e)).toBe(true);
    expect(classifyError(e)).toBe(e);
  });

  it('redacts credentials from serialized messages and causes', () => {
    const error = {
      name: 'MongoServerSelectionError',
      message: 'Failed to connect to mongodb://alice:hunter2@db.example.com/app',
      cause: {
        message: 'socket error for mongodb+srv://bob:token123@cluster.example.net/admin',
      },
    };

    const serialized = serializeError(error);
    expect(serialized.message).toContain('db.example.com/app');
    expect(serialized.message).toContain('<redacted>');
    expect(serialized.causeMessage).toContain('cluster.example.net/admin');
    expect(serialized.causeMessage).toContain('<redacted>');
    expect(JSON.stringify(serialized)).not.toContain('hunter2');
    expect(JSON.stringify(serialized)).not.toContain('token123');
  });

  it('redacts credentials from existing AppErrors', () => {
    const serialized = serializeError(appError(
      'InvalidConnectionString',
      'Invalid mongodb://user:pass@localhost:27017/test',
    ));

    expect(serialized.message).toContain('Invalid mongodb://');
    expect(serialized.message).toContain('<redacted>');
    expect(serialized.message).toContain('localhost:27017/test');
    expect(serialized.message).not.toContain('user:pass');
  });
});
