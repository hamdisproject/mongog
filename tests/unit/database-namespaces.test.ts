import { describe, expect, it } from 'vitest';
import {
  collectionNameError,
  databaseNameError,
  namespaceLengthError,
} from '../../src/shared/domain/namespaces.js';
import {
  connDatabaseCreateSchema,
  connDatabaseRenameStartSchema,
} from '../../src/shared/ipc/index.js';

describe('database and collection namespace validation', () => {
  it('accepts database names from 1 through 63 UTF-8 bytes', () => {
    expect(databaseNameError('a')).toBeNull();
    expect(databaseNameError('a'.repeat(63))).toBeNull();
    expect(databaseNameError('ş'.repeat(31))).toBeNull();
    expect(databaseNameError('ş'.repeat(32))).toContain('64 UTF-8 bytes');
    expect(databaseNameError('a'.repeat(64))).toContain('64 UTF-8 bytes');
  });

  it.each(['', ' leading', 'trailing ', 'has space', 'a/b', 'a\\b', 'a.b', 'a$b', 'a*b', 'a<b', 'a>b', 'a:b', 'a|b', 'a?b', 'a\0b'])(
    'rejects an invalid database name: %j',
    (name) => expect(databaseNameError(name)).not.toBeNull(),
  );

  it.each(['admin', 'ADMIN', 'config', 'Local'])(
    'rejects MongoDB protected database name %s',
    (name) => expect(databaseNameError(name)).toContain('reserved'),
  );

  it('validates collection names and the complete namespace byte length', () => {
    expect(collectionNameError('documents.v2')).toBeNull();
    expect(collectionNameError('foo.system.bar')).toBeNull();
    expect(collectionNameError('')).not.toBeNull();
    expect(collectionNameError('system.profile')).not.toBeNull();
    expect(collectionNameError('price$history')).not.toBeNull();
    expect(collectionNameError('bad\0name')).not.toBeNull();
    expect(namespaceLengthError('a'.repeat(63), 'b'.repeat(191))).toBeNull();
    expect(namespaceLengthError('a'.repeat(63), 'b'.repeat(192))).toContain('255 UTF-8 bytes');
  });

  it('applies the same validation at the typed IPC boundary without silently trimming', () => {
    expect(connDatabaseCreateSchema.safeParse({
      connectionId: 'connection', database: 'app', collection: 'items',
    }).success).toBe(true);
    expect(connDatabaseCreateSchema.safeParse({
      connectionId: 'connection', database: ' app', collection: 'items',
    }).success).toBe(false);
    expect(connDatabaseCreateSchema.safeParse({
      connectionId: 'connection', database: 'app', collection: ' system.profile',
    }).success).toBe(false);
    expect(connDatabaseRenameStartSchema.safeParse({
      connectionId: 'connection', database: 'app', newDatabase: 'APP',
    }).success).toBe(false);
  });
});
