import { describe, expect, it } from 'vitest';
import {
  filterQueryCompletions,
  type QueryCompletionEntry,
} from '../../../src/renderer/monaco/query-completion-policy.js';

function ambient(name: string, kind = 'var'): QueryCompletionEntry {
  return { name, kind, kindModifiers: 'declare', sortText: '15' };
}

function names(entries: QueryCompletionEntry[]): string[] {
  return entries.map((entry) => entry.name);
}

describe('query editor completion policy', () => {
  it('drops browser, rare BSON and other ambient globals outside the allowlist', () => {
    const filtered = filterQueryCompletions({
      isMemberCompletion: false,
      entries: [
        ambient('document'),
        ambient('HTMLElement'),
        ambient('DataView'),
        ambient('BinData', 'function'),
        ambient('NumberLong', 'function'),
        ambient('db', 'let'),
        ambient('use', 'function'),
        ambient('ObjectId', 'const'),
        ambient('Math'),
        { name: 'const', kind: 'keyword', kindModifiers: '', sortText: '15' },
      ],
    });
    expect(names(filtered!.entries)).toEqual(['db', 'use', 'ObjectId', 'Math', 'const']);
  });

  it('keeps the script\'s own declarations', () => {
    const entries = [
      { name: 'users', kind: 'const', kindModifiers: '', sortText: '15' },
      { name: 'item', kind: 'const', kindModifiers: '', sortText: '11' },
    ];
    expect(filterQueryCompletions({ isMemberCompletion: false, entries })!.entries).toEqual(entries);
  });

  it('leaves member completions untouched', () => {
    const info = { isMemberCompletion: true, entries: [ambient('document'), ambient('collection', 'method')] };
    expect(filterQueryCompletions(info)).toBe(info);
  });

  it('ranks MongoDB shell globals above other globals but below local declarations', () => {
    const filtered = filterQueryCompletions({
      isMemberCompletion: false,
      entries: [ambient('Date'), ambient('db', 'let'), ambient('print', 'function')],
    });
    expect(filtered!.entries.map((entry) => [entry.name, entry.sortText])).toEqual([
      ['Date', '15'],
      ['db', '11'],
      ['print', '11'],
    ]);
  });

  it('passes a missing result through', () => {
    expect(filterQueryCompletions(undefined)).toBeUndefined();
  });
});
