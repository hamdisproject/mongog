import { Int32, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import { formatConsoleEntry, formatConsoleOutput } from '../../src/renderer/console-output.js';
import { serializeToEjson } from '../../src/shared/ejson/index.js';
import type { ConsoleEntry } from '../../src/shared/domain/index.js';

describe('console output formatting', () => {
  const objectId = new ObjectId('64b64c000000000000000001');

  it('copies entries in display order with their levels and BSON-aware arguments', () => {
    const entries: ConsoleEntry[] = [
      {
        level: 'log',
        statementIndex: 0,
        args: [serializeToEjson('hello'), serializeToEjson(objectId)],
      },
      {
        level: 'warn',
        statementIndex: 1,
        args: [serializeToEjson({ count: new Int32(7) })],
      },
    ];

    expect(formatConsoleOutput(entries, 'mongosh')).toBe([
      'console.log "hello" ObjectId("64b64c000000000000000001")',
      'console.warn { count: 7 }',
    ].join('\n'));
  });

  it('uses the active relaxed or canonical EJSON display mode', () => {
    const entry: ConsoleEntry = {
      level: 'info',
      statementIndex: 0,
      args: [serializeToEjson({ count: new Int32(7) })],
    };

    expect(formatConsoleEntry(entry, 'relaxed')).toBe('console.info {"count":7}');
    expect(formatConsoleEntry(entry, 'canonical'))
      .toBe('console.info {"count":{"$numberInt":"7"}}');
  });

  it('preserves multi-line truncated previews and handles entries without arguments', () => {
    const entries: ConsoleEntry[] = [
      { level: 'log', statementIndex: 0, args: [] },
      {
        level: 'error',
        statementIndex: 1,
        args: [{ ejson: '{"payload":"preview', byteSize: 2_048, truncated: true }],
      },
    ];

    expect(formatConsoleOutput(entries, 'mongosh')).toBe([
      'console.log',
      'console.error {"payload":"preview',
      '… truncated preview (2.0 KB original)',
    ].join('\n'));
  });

  it('falls back to the envelope text when an argument cannot be parsed', () => {
    const entry: ConsoleEntry = {
      level: 'error',
      statementIndex: 0,
      args: [{ ejson: 'unparseable preview', byteSize: 19, truncated: false }],
    };

    expect(formatConsoleEntry(entry, 'mongosh')).toBe('console.error unparseable preview');
  });
});
