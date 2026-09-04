import { Int32, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  formatQueryErrorOutput,
  formatQueryResultOutput,
  renderQueryEnvelope,
} from '../../src/renderer/query-output.js';
import { serializeToEjson } from '../../src/shared/ejson/index.js';

describe('query result output formatting', () => {
  it('formats the current document page as one BSON-aware array', () => {
    const output = formatQueryResultOutput({
      kind: 'documents',
      cursorId: 'cursor-1',
      documents: [
        serializeToEjson({ _id: new ObjectId('64b64c000000000000000001'), count: new Int32(7) }),
        serializeToEjson({ enabled: true }),
      ],
      pageSize: 50,
      hasMore: true,
    }, 'mongosh');

    expect(output).toContain('ObjectId("64b64c000000000000000001")');
    expect(output).toContain('count: 7');
    expect(output.trim().startsWith('[')).toBe(true);
    expect(output.trim().endsWith(']')).toBe(true);
  });

  it('preserves the active relaxed and canonical EJSON modes', () => {
    const result = { kind: 'scalar', value: serializeToEjson({ count: new Int32(7) }) } as const;
    expect(formatQueryResultOutput(result, 'relaxed')).toBe('{\n  "count": 7\n}');
    expect(formatQueryResultOutput(result, 'canonical'))
      .toBe('{\n  "count": {\n    "$numberInt": "7"\n  }\n}');
  });

  it('copies an empty page and represents truncated or invalid documents safely', () => {
    expect(formatQueryResultOutput({
      kind: 'documents', cursorId: 'empty', documents: [], pageSize: 25, hasMore: false,
    }, 'mongosh')).toBe('[]');

    const output = formatQueryResultOutput({
      kind: 'documents',
      cursorId: 'preview',
      documents: [
        { ejson: '{"large":"preview', byteSize: 4_096, truncated: true, fullValueId: 'opaque-1' },
        { ejson: 'invalid', byteSize: 7, truncated: false },
      ],
      pageSize: 25,
      hasMore: false,
    }, 'mongosh');
    expect(output).toContain('$preview: "{\\"large\\":\\"preview"');
    expect(output).toContain('$truncated: true');
    expect(output).toContain('$originalBytes: 4096');
    expect(output).toContain('$parseError: true');
  });

  it('formats write, opaque, change-stream, console, and error results', () => {
    expect(formatQueryResultOutput({
      kind: 'write',
      op: 'update',
      matchedCount: 2,
      modifiedCount: 1,
      raw: serializeToEjson({ acknowledged: true }),
    }, 'mongosh')).toContain('modified: 1');
    expect(formatQueryResultOutput({ kind: 'opaque', preview: 'opaque preview' }, 'mongosh'))
      .toBe('opaque preview');
    expect(formatQueryResultOutput({ kind: 'changeStream', streamId: '1234567890', buffered: 3 }, 'mongosh'))
      .toBe('Change stream 12345678… (3 buffered)');
    expect(formatQueryResultOutput({
      kind: 'console',
      entries: [{ level: 'info', statementIndex: 0, args: [serializeToEjson('ready')] }],
    }, 'mongosh')).toBe('console.info "ready"');
    expect(formatQueryResultOutput({
      kind: 'error',
      error: { category: 'Validation', message: 'Invalid value', hint: 'Check the input.' },
    }, 'mongosh')).toBe('Validation: Invalid value\nHint: Check the input.');
    expect(formatQueryErrorOutput({ category: 'MongoDBCommand', message: 'Driver failed' }))
      .toBe('MongoDBCommand: Driver failed');
  });

  it('keeps scalar truncated previews and invalid envelopes aligned with rendering', () => {
    expect(renderQueryEnvelope({ ejson: 'preview', byteSize: 2_048, truncated: true }, 'mongosh', true))
      .toBe('preview\n… truncated preview (2.0 KB original)');
    expect(renderQueryEnvelope({ ejson: 'invalid', byteSize: 7, truncated: false }, 'mongosh', true))
      .toBe('invalid');
  });
});
