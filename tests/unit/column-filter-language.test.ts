import { describe, expect, it } from 'vitest';
import type { SchemaFieldInfo } from '../../src/shared/domain/index.js';
import { completeColumnFilter, tokenizeColumnFilter } from '../../src/renderer/column-filter-language.js';

const fields: SchemaFieldInfo[] = [
  'catalog.city', 'catalog.products', 'catalog.products[].name', 'catalog.products[].price',
  'catalog.products[].tags', 'catalog.products[].details', 'catalog.products[].details.brand',
  'catalog.products[].items', 'catalog.products[].items[].sku', 'catalog.şehir',
  'catalog.display name', 'catalog.a"b', 'catalog.$bad',
  'other.secret',
].map((path) => ({ path, types: [{ bsonType: 'string', proportion: 1 }], presence: 1, exampleEjson: '"DO NOT SUGGEST"' }));

function suggest(marked: string, manual = false) {
  const caret = marked.indexOf('|');
  return completeColumnFilter(marked.replace('|', ''), caret, 'catalog', fields, manual);
}

function accept(marked: string, label: string) {
  const suggestion = suggest(marked).find((item) => item.label === label)!;
  expect(suggestion).toBeDefined();
  const source = marked.replace('|', '');
  return source.slice(0, suggestion.start) + suggestion.insertText + source.slice(suggestion.end);
}

describe('column filter highlighting', () => {
  it('colors selectors separately from operators, literals and delimiters', () => {
    const source = '{products}[{tags}]: len >= 2 AND !has *Used* OR [{price}]: <> 100';
    const tokens = tokenizeColumnFilter(source);
    expect(tokens.filter((token) => token.kind === 'property').map((token) => token.text)).toEqual(['products', 'tags', 'price']);
    expect(tokens.filter((token) => token.kind === 'keyword').map((token) => token.text)).toEqual(['len', '!has']);
    expect(tokens.filter((token) => token.kind === 'operator').map((token) => token.text)).toEqual(['>=', 'AND', '*', '*', 'OR', '<>']);
    expect(tokens.map((token) => token.text).join('')).toBe(source);
  });

  it.each(['100..200', 'len <= 5 && has true || !has null', '!= 3', '[{"şehir"}]: ObjectId("507f1f77bcf86cd799439011")', '{unfinished', '[{"display na', 'has "len AND <>"', '/has OR [<>]/i', 'has /[/]/'])('retains all source characters in %s', (source) => {
    const tokens = tokenizeColumnFilter(source);
    expect(tokens.map((token) => token.text).join('')).toBe(source);
    for (const token of tokens) expect(source.slice(token.start, token.end)).toBe(token.text);
  });

  it('protects string, regex and BSON literal contents from DSL highlighting', () => {
    for (const source of ['"has AND len <>"', '/has OR <>/i', '{ text: "has OR len" }', 'Code("has OR len")']) {
      expect(tokenizeColumnFilter(source).filter((token) => token.kind === 'operator')).toEqual([]);
    }
    expect(tokenizeColumnFilter('ObjectId("abc")')[0]?.kind).toBe('constructor');
    expect(tokenizeColumnFilter('has /x/i').find((token) => token.kind === 'regexp')?.text).toBe('/x/i');
  });
});

describe('column filter suggestions', () => {
  it('offers only matching syntax at a condition start and after len', () => {
    expect(suggest('!|').map((item) => item.label)).toEqual(['!=', '!has']);
    expect(suggest('ha|').map((item) => item.label)).toEqual(['has']);
    expect(suggest('le|').map((item) => item.label)).toEqual(['len']);
    expect(suggest('len >|').map((item) => item.label)).toEqual(['>', '>=']);
    expect(suggest('has 3 AND !|').map((item) => item.label)).toEqual(['!=', '!has']);
    expect(suggest('|', true).map((item) => item.label)).toContain('has');
    expect(suggest('|')).toEqual([]);
  });

  it.each(['has 3|', 'has |', 'has A|', 'len A|', '> A|', 'len >= 2|', 'len >= 2 |', 'Istanbul|', 'true|', '"has A|"', '/has A|/i', 'ObjectId("A|")', '{ x: 1 A| }'])('does not open an intrusive or invalid list in %s', (source) => {
    expect(suggest(source)).toEqual([]);
  });

  it('offers AND/OR only at logical continuations, not inside literals', () => {
    expect(suggest('3 A|').map((item) => item.label)).toEqual(['AND']);
    expect(suggest('has "wifi" O|').map((item) => item.label)).toEqual(['OR']);
    expect(suggest('3 |', true).map((item) => item.label)).toEqual(['AND', 'OR', '&&', '||']);
  });

  it('limits field suggestions to direct children of the selected object or array', () => {
    expect(suggest('{|').map((item) => item.label)).toEqual(['a"b', 'city', 'display name', 'products', 'şehir']);
    expect(suggest('{products}[{p|').map((item) => item.label)).toEqual(['price']);
    expect(suggest('{products}[{details}{b|').map((item) => item.label)).toEqual(['brand']);
    expect(suggest('{products}[{items}][{s|').map((item) => item.label)).toEqual(['sku']);
    expect(suggest('{products}[{name}]: wifi OR {c|').map((item) => item.label)).toEqual(['city']);
  });

  it('replaces a partial field without duplicating closing delimiters or changing the suffix', () => {
    expect(accept('{products}[{na|me}]: *Com*', 'name')).toBe('{products}[{name}]: *Com*');
    expect(accept('{products}[{na|}', 'name')).toBe('{products}[{name}]');
    expect(accept('{"display n|"}: 3', 'display name')).toBe('{"display name"}: 3');
    expect(accept('{ş|}', 'şehir')).toBe('{şehir}');
    expect(accept('{a|}', 'a"b')).toBe('{"a\\"b"}');
    expect(accept('ha|s 3', 'has')).toBe('has 3');
  });

  it('keeps operator suggestions available without schema and never suggests example values', () => {
    expect(completeColumnFilter('ha', 2, 'catalog', []).map((item) => item.label)).toEqual(['has']);
    expect(JSON.stringify(suggest('{|'))).not.toContain('DO NOT SUGGEST');
    expect(suggest('{unknown|')).toEqual([]);
  });
});
