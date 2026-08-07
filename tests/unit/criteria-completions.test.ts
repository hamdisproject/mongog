import { describe, expect, it } from 'vitest';
import {
  buildSemanticSuggestions,
  detectCompletionContext,
} from '../../src/features/script-analysis/index.js';
import {
  buildCriteriaVirtualSource,
  criteriaSuggestionInsertText,
} from '../../src/renderer/monaco/criteria-completions.js';

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
});
