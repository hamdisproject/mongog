import * as mongodb from 'mongodb';
import { appError } from '../../shared/errors/index.js';

/** Shared by the early AST warning and the authoritative runtime guard. */
export const READ_ONLY_WRITE_METHODS = new Set<string>([
  'bulkWrite',
  'createCollection',
  'createIndex',
  'createIndexes',
  'createSearchIndex',
  'createSearchIndexes',
  'createView',
  'delete',
  'deleteMany',
  'deleteOne',
  'drop',
  'dropCollection',
  'dropDatabase',
  'dropIndex',
  'dropIndexes',
  'dropSearchIndex',
  'findAndModify',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'initializeOrderedBulkOp',
  'initializeUnorderedBulkOp',
  'insertMany',
  'insertOne',
  'mapReduce',
  'openUploadStream',
  'openUploadStreamWithId',
  'rename',
  'renameCollection',
  'removeUser',
  'replaceOne',
  'setProfilingLevel',
  'updateMany',
  'updateOne',
  'updateSearchIndex',
]);

export const READ_ONLY_WRITE_COMMAND_KEYS = new Set<string>([
  '_configsvrAddShard',
  'applyOps',
  'collMod',
  'convertToCapped',
  'create',
  'createIndexes',
  'createRole',
  'createUser',
  'delete',
  'drop',
  'dropAllRolesFromDatabase',
  'dropAllUsersFromDatabase',
  'dropDatabase',
  'dropIndexes',
  'dropRole',
  'dropUser',
  'findAndModify',
  'grantPrivilegesToRole',
  'grantRolesToRole',
  'grantRolesToUser',
  'insert',
  'mapReduce',
  'profile',
  'renameCollection',
  'reIndex',
  'revokePrivilegesFromRole',
  'revokeRolesFromRole',
  'revokeRolesFromUser',
  'setFeatureCompatibilityVersion',
  'update',
  'updateRole',
  'updateUser',
]);

export interface ReadOnlyDriverGuard {
  client: mongodb.MongoClient;
  mongodb: typeof mongodb;
}

/**
 * Wrap real driver objects without replacing their API surface. The proxy is
 * an application-side guard against accidental and trivially-obfuscated
 * writes; MongoDB server roles remain authoritative.
 */
export function createReadOnlyDriverGuard(client: mongodb.MongoClient): ReadOnlyDriverGuard {
  const cache = new WeakMap<object, object>();

  const wrapKnown = (value: unknown): unknown => {
    if (!isGuardedDriverObject(value)) return value;
    const cached = cache.get(value);
    if (cached) return cached;

    const proxy = new Proxy(value, {
      get(target, property) {
        if (typeof property === 'string' && READ_ONLY_WRITE_METHODS.has(property)) {
          return blockedMethod(property);
        }
        const member = Reflect.get(target, property, target) as unknown;
        if (typeof member !== 'function') return wrapKnown(member);

        if (property === 'command' || property === 'runCursorCommand') {
          return (command: unknown, ...args: unknown[]) => {
            assertReadOnlyCommand(command);
            return wrapResult(Reflect.apply(member, target, [command, ...args]));
          };
        }
        if (property === 'aggregate') {
          return (pipeline: unknown, ...args: unknown[]) => {
            assertReadOnlyPipeline(pipeline);
            return wrapResult(Reflect.apply(member, target, [pipeline, ...args]));
          };
        }
        return (...args: unknown[]) => wrapResult(Reflect.apply(member, target, args));
      },
    });
    cache.set(value, proxy);
    return proxy;
  };

  const wrapResult = (value: unknown): unknown => {
    if (value && typeof value === 'object' && 'then' in value && typeof (value as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(value).then((resolved) => wrapKnown(resolved));
    }
    return wrapKnown(value);
  };

  const guardConstructor = <T extends abstract new (...args: never[]) => object>(constructor: T): T => (
    new Proxy(constructor, {
      construct(target, args, newTarget) {
        return wrapKnown(Reflect.construct(target, args, newTarget)) as object;
      },
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver) as unknown;
        if (property === 'connect' && typeof member === 'function') {
          return (...args: unknown[]) => wrapResult(Reflect.apply(member, target, args));
        }
        return member;
      },
    }) as T
  );

  const guardedModule = {
    ...mongodb,
    MongoClient: guardConstructor(mongodb.MongoClient),
    GridFSBucket: guardConstructor(mongodb.GridFSBucket),
  } as typeof mongodb;

  return {
    client: wrapKnown(client) as mongodb.MongoClient,
    mongodb: guardedModule,
  };
}

function isGuardedDriverObject(value: unknown): value is object {
  return value instanceof mongodb.MongoClient ||
    value instanceof mongodb.Db ||
    value instanceof mongodb.Collection ||
    value instanceof mongodb.Admin ||
    value instanceof mongodb.GridFSBucket;
}

function blockedMethod(method: string): (...args: unknown[]) => never {
  return () => {
    throw appError('ReadOnlyProtection', `Read-only connection: write operation "${method}()" is blocked.`, {
      hint: 'Use a MongoDB user with the read role for authoritative server-side protection.',
    });
  };
}

function assertReadOnlyCommand(command: unknown): void {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return;
  const key = Object.keys(command).find((candidate) => READ_ONLY_WRITE_COMMAND_KEYS.has(candidate));
  if (!key) return;
  throw appError('ReadOnlyProtection', `Read-only connection: command "${key}" is blocked.`, {
    hint: 'Use a MongoDB user with the read role for authoritative server-side protection.',
  });
}

function assertReadOnlyPipeline(pipeline: unknown): void {
  if (!Array.isArray(pipeline)) return;
  if (!pipeline.some((stage) => containsWriteStage(stage))) return;
  throw appError('ReadOnlyProtection', 'Read-only connection: aggregation with $out/$merge is blocked.', {
    hint: 'Use a MongoDB user with the read role for authoritative server-side protection.',
  });
}

function containsWriteStage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsWriteStage(entry));
  return Object.entries(value).some(([key, nested]) => (
    key === '$out' || key === '$merge' || containsWriteStage(nested)
  ));
}
