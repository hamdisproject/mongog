/**
 * vm sandbox construction (ADR-05).
 *
 * The sandbox receives REAL driver objects (MongoClient, Db, module
 * namespace). This is what makes "every driver method callable from the
 * editor" true without any per-method IPC layer.
 *
 * vm is an isolation mechanism for scope management, NOT a security
 * boundary — Trusted Script Mode is documented accordingly.
 */
import vm from 'node:vm';
import * as mongodb from 'mongodb';
import * as bson from 'bson';
import type { ConsoleEntry } from '../../shared/domain/index.js';
import { serializeToEjson } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import { createAutoAwaitRuntime, type AutoAwaitHooks } from './auto-await.js';
import { createReadOnlyDriverGuard } from './read-only-guard.js';

export interface SandboxOptions {
  client: mongodb.MongoClient;
  database: string;
  mode: 'query' | 'trusted';
  readOnly?: boolean;
  capture: (index: number, thunk: () => Promise<unknown>) => Promise<unknown>;
  mark: (index: number) => void;
  onConsole: (entry: ConsoleEntry) => void;
  currentStatementIndex: () => number;
  consoleEntryLimit?: number;
  autoAwait?: { identifier: string; hooks: AutoAwaitHooks };
}

export interface SandboxHandle {
  context: vm.Context;
  getCurrentDb: () => mongodb.Db;
  getCurrentDatabaseName: () => string;
}

const CONSOLE_ARG_PREVIEW_BYTES = 16 * 1024;

function shellFactory<T extends abstract new (...args: never[]) => unknown>(
  constructor: T,
  factory: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  Object.setPrototypeOf(factory, constructor);
  Object.defineProperty(factory, 'prototype', { value: constructor.prototype });
  return factory;
}

const shellObjectId = shellFactory(bson.ObjectId, (value?: unknown) => (
  new bson.ObjectId(value === undefined ? undefined : String(value))
));
const shellInt32 = shellFactory(bson.Int32, (value: unknown = 0) => (
  typeof value === 'string' ? bson.Int32.fromString(value) : new bson.Int32(Number(value))
));
const shellLong = shellFactory(bson.Long, (value: unknown = '0') => (
  typeof value === 'string' ? bson.Long.fromString(value) : bson.Long.fromValue(value as number)
));
const shellDouble = shellFactory(bson.Double, (value: unknown = 0) => (
  typeof value === 'string' ? bson.Double.fromString(value) : new bson.Double(Number(value))
));
const shellDecimal128 = shellFactory(bson.Decimal128, (value: unknown = '0') => (
  bson.Decimal128.fromString(String(value))
));
const shellBsonRegExp = shellFactory(bson.BSONRegExp, (pattern: unknown, options: unknown = '') => (
  new bson.BSONRegExp(String(pattern), String(options))
));
const shellTimestamp = shellFactory(bson.Timestamp, (value: unknown, increment?: unknown) => (
  typeof value === 'object' && value !== null
    ? new bson.Timestamp(value as { t: number; i: number })
    : new bson.Timestamp({ t: Number(value), i: Number(increment ?? 0) })
));
const shellMinKey = shellFactory(bson.MinKey, () => new bson.MinKey());
const shellMaxKey = shellFactory(bson.MaxKey, () => new bson.MaxKey());
const shellDbRef = shellFactory(bson.DBRef, (
  collection: unknown,
  oid: unknown,
  database?: unknown,
  fields?: unknown,
) => new bson.DBRef(
  String(collection),
  oid as bson.ObjectId,
  database === undefined ? undefined : String(database),
  fields as bson.Document | undefined,
));
const shellCode = shellFactory(bson.Code, (code: unknown, scope?: unknown) => (
  new bson.Code(String(code), scope as bson.Document | undefined)
));
const shellBsonSymbol = shellFactory(bson.BSONSymbol, (value: unknown) => new bson.BSONSymbol(String(value)));
const shellUuid = shellFactory(bson.UUID, (value?: unknown) => (
  value === undefined ? new bson.UUID() : new bson.UUID(String(value))
));

export function createSandbox(options: SandboxOptions): SandboxHandle {
  type ShellCompatibleDb = mongodb.Db & {
    getSiblingDB(databaseName: string): ShellCompatibleDb;
  };
  const guarded = options.readOnly ? createReadOnlyDriverGuard(options.client) : null;
  const sandboxClient = guarded?.client ?? options.client;
  const sandboxMongoModule = guarded?.mongodb ?? mongodb;
  const shellDb = (databaseName: string): ShellCompatibleDb => {
    const value = sandboxClient.db(databaseName) as ShellCompatibleDb;
    if (!Object.hasOwn(value, 'getSiblingDB')) {
      Object.defineProperty(value, 'getSiblingDB', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: (name: string) => {
          if (typeof name !== 'string' || name.length === 0) {
            throw new Error('getSiblingDB(databaseName: string) requires a non-empty string.');
          }
          return shellDb(name);
        },
      });
    }
    return value;
  };
  let currentDb = shellDb(options.database);
  let consoleCount = 0;
  const consoleLimit = options.consoleEntryLimit ?? 1000;

  const emitConsole = (level: ConsoleEntry['level'], values: unknown[]): void => {
    consoleCount += 1;
    if (consoleCount > consoleLimit) {
      if (consoleCount === consoleLimit + 1) {
        options.onConsole({
          level: 'warn',
          statementIndex: options.currentStatementIndex(),
          args: [
            serializeToEjson(`[MongoG] console output truncated after ${consoleLimit} entries`),
          ],
        });
      }
      return;
    }
    options.onConsole({
      level,
      statementIndex: options.currentStatementIndex(),
      args: values.map((v) => serializeToEjson(v, CONSOLE_ARG_PREVIEW_BYTES)),
    });
  };

  const sandboxConsole = {
    log: (...v: unknown[]) => emitConsole('log', v),
    info: (...v: unknown[]) => emitConsole('info', v),
    warn: (...v: unknown[]) => emitConsole('warn', v),
    error: (...v: unknown[]) => emitConsole('error', v),
    debug: (...v: unknown[]) => emitConsole('log', v),
  };

  const sandbox: Record<string, unknown> = {
    mongodb: sandboxMongoModule,
    bson,
    ObjectId: shellObjectId,
    ISODate: (value?: unknown) => value === undefined ? new Date() : new Date(String(value)),
    Int32: shellInt32,
    NumberInt: shellInt32,
    Long: shellLong,
    NumberLong: shellLong,
    Double: shellDouble,
    Decimal128: shellDecimal128,
    NumberDecimal: shellDecimal128,
    BinData: (subtype: unknown, base64: unknown) => bson.Binary.createFromBase64(String(base64), Number(subtype)),
    UUID: shellUuid,
    BSONRegExp: shellBsonRegExp,
    Timestamp: shellTimestamp,
    MinKey: shellMinKey,
    MaxKey: shellMaxKey,
    DBRef: shellDbRef,
    Code: shellCode,
    BSONSymbol: shellBsonSymbol,
    client: sandboxClient,
    db: currentDb,
    use(name: string) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('use(databaseName: string) requires a non-empty string.');
      }
      currentDb = shellDb(name);
      (sandbox as { db: mongodb.Db }).db = currentDb;
      return currentDb;
    },
    print: (...v: unknown[]) => emitConsole('log', v),
    printjson: (v: unknown) => emitConsole('log', [v]),
    console: sandboxConsole,
    __mongogCapture: options.capture,
    __mongogMark: options.mark,
  };

  if (options.mode === 'trusted') {
    // Allowlisted module access only (ADR-05). No arbitrary npm installs.
    sandbox.require = (name: string): unknown => {
      if (name === 'mongodb') return sandboxMongoModule;
      if (name === 'bson') return bson;
      throw Object.assign(
        new Error(`Module "${name}" is not available in scripts (allowlist: mongodb, bson).`),
        { name: 'ModuleNotAllowed' },
      );
    };
  }

  const context = vm.createContext(sandbox, {
    name: 'mongog-script-context',
    codeGeneration: { strings: false, wasm: false },
  });
  if (options.autoAwait) {
    const runtime = createAutoAwaitRuntime(options.autoAwait.hooks);
    sandbox[options.autoAwait.identifier] = runtime;
    runtime.install(vm.runInContext('Array', context) as ArrayConstructor, vm.runInContext('Promise', context) as PromiseConstructor);
  }
  vm.createContext(sandbox, { name: 'x' }); // no-op guard against accidental double-context misuse

  return {
    context,
    getCurrentDb: () => currentDb,
    getCurrentDatabaseName: () => currentDb.databaseName,
  };
}

export function moduleNotAllowedError(name: string) {
  return appError('ModuleNotAllowed', `Module "${name}" is not allowed.`);
}
