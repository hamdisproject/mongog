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

export interface SandboxOptions {
  client: mongodb.MongoClient;
  database: string;
  mode: 'query' | 'trusted';
  capture: (index: number, thunk: () => Promise<unknown>) => Promise<unknown>;
  mark: (index: number) => void;
  onConsole: (entry: ConsoleEntry) => void;
  currentStatementIndex: () => number;
  consoleEntryLimit?: number;
}

export interface SandboxHandle {
  context: vm.Context;
  getCurrentDb: () => mongodb.Db;
  getCurrentDatabaseName: () => string;
}

const CONSOLE_ARG_PREVIEW_BYTES = 16 * 1024;

export function createSandbox(options: SandboxOptions): SandboxHandle {
  let currentDb = options.client.db(options.database);
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
    mongodb,
    bson,
    client: options.client,
    db: currentDb,
    use(name: string) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('use(databaseName: string) requires a non-empty string.');
      }
      currentDb = options.client.db(name);
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
      if (name === 'mongodb') return mongodb;
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
