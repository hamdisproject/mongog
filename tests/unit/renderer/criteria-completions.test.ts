import { describe, expect, it } from 'vitest';
import {
  buildSemanticSuggestions,
  detectCompletionContext,
} from '../../../src/features/script-analysis/index.js';
import {
  bsonConstructorSuggestions,
  buildCriteriaVirtualSource,
  criteriaConstructorSuggestions,
  criteriaSuggestionInsertText,
  type CriteriaKind,
} from '../../../src/renderer/monaco/criteria-completions.js';

describe('Documents criteria completions', () => {
  it.each([
    ['filter', 'filter'],
    ['sort', 'sort'],
    ['projection', 'projection'],
  ] as const)('maps the %s model into a %s driver document context', (kind, docKind) => {
    const expression = '{ }';
    const virtual = buildCriteriaVirtualSource(expression, 2, {
      collection: 'bikes.archive',
      kind,
    });
    const context = detectCompletionContext(virtual.source, virtual.offset, 'typescript');
    expect(context).toMatchObject({
      kind: 'document-key',
      docKind,
      collection: 'bikes.archive',
    });
  });

  it('offers schema fields and filter operators from the virtual context', () => {
    const fields = [{
      path: 'bikeid',
      types: [{ bsonType: 'int', proportion: 1 }],
      presence: 1,
    }];
    const fieldVirtual = buildCriteriaVirtualSource('{ }', 2, {
      collection: 'bikes',
      kind: 'filter',
    });
    const fieldContext = detectCompletionContext(
      fieldVirtual.source,
      fieldVirtual.offset,
      'typescript',
    );
    expect(buildSemanticSuggestions(fieldContext, { fields }).map((item) => item.label))
      .toContain('bikeid');

    const operatorVirtual = buildCriteriaVirtualSource('{ $ }', 3, {
      collection: 'bikes',
      kind: 'filter',
    });
    const operatorContext = detectCompletionContext(
      operatorVirtual.source,
      operatorVirtual.offset,
      'typescript',
    );
    expect(buildSemanticSuggestions(operatorContext, { fields }).map((item) => item.label))
      .toContain('$or');
  });

  it('quotes field names that are not valid object-literal identifiers', () => {
    expect(criteriaSuggestionInsertText(
      { kind: 'field', insertText: 'bike.id' },
      '',
      false,
    )).toBe('"bike.id"');
    expect(criteriaSuggestionInsertText(
      { kind: 'field', insertText: 'bikeid' },
      '',
      false,
    )).toBe('bikeid');
    expect(criteriaSuggestionInsertText(
      { kind: 'field', insertText: 'bisikletŞasi' },
      '',
      false,
    )).toBe('bisikletŞasi');
  });

  it('suggests only the common BSON helpers, as snippets with literal arguments', () => {
    const suggestions = new Map(bsonConstructorSuggestions.map((item) => [item.label, item.insertText]));
    expect([...suggestions.keys()]).toEqual(['ObjectId', 'ISODate', 'UUID']);
    expect(suggestions.get('ObjectId')).toContain('507f1f77bcf86cd799439011');
    expect(suggestions.get('ISODate')).toContain('2026-01-01T00:00:00.000Z');
    expect(suggestions.get('UUID')).toContain('00112233-4455-6677-8899-aabbccddeeff');
  });

  it.each([
    '{ _id: O█ }',
    '{ _id: █ }',
    '{ tags: { $in: [U█] } }',
  ])('offers BSON helpers in Filter value positions: %s', (fixture) => {
    expect(constructorsAt('filter', fixture)).toEqual(['ObjectId', 'ISODate', 'UUID']);
  });

  it.each([
    ['filter', '{ B█ }'],
    ['filter', '{ age: { $█ } }'],
    ['filter', '█'],
    ['sort', '{ age: █ }'],
    ['projection', '{ name: █ }'],
  ] as const)('offers no BSON helpers in %s %s', (kind, fixture) => {
    expect(constructorsAt(kind, fixture)).toEqual([]);
  });

  it('offers no BSON helpers inside quoted values', () => {
    expect(constructorsAt('filter', '{ name: "O█" }', true)).toEqual([]);
  });
});

function constructorsAt(kind: CriteriaKind, fixture: string, insideQuotedToken = false): string[] {
  const offset = fixture.indexOf('█');
  const virtual = buildCriteriaVirtualSource(fixture.replace('█', ''), offset, { collection: 'bikes', kind });
  const context = detectCompletionContext(virtual.source, virtual.offset, 'typescript');
  return criteriaConstructorSuggestions(kind, context, insideQuotedToken).map((item) => item.label);
}
