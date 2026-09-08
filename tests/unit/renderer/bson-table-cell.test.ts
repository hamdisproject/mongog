import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';

import {
  BsonTableCell,
  formatBsonTableField,
  resolveBsonTableField,
} from '../../../src/renderer/components/Common/BsonTableCell.js';

describe('BSON table cells', () => {
  it('distinguishes an absent field from an explicitly null field', () => {
    const missing = resolveBsonTableField({ other: true }, 'value');
    const explicitNull = resolveBsonTableField({ value: null }, 'value');

    expect(formatBsonTableField(missing, 'mongosh')).toMatchObject({
      fullText: 'Not Set',
      visibleText: 'Not Set',
      notSet: true,
    });
    expect(formatBsonTableField(explicitNull, 'mongosh')).toMatchObject({
      fullText: 'null',
      visibleText: 'null',
      notSet: false,
    });
  });

  it.each([
    [{ value: false }, 'false'],
    [{ value: 0 }, '0'],
    [{ value: '' }, '""'],
  ] as const)('preserves set falsy values in %j', (document, expected) => {
    expect(formatBsonTableField(
      resolveBsonTableField(document, 'value'),
      'mongosh',
    ).fullText).toBe(expected);
  });

  it('uses own-property presence rather than inherited values', () => {
    const document = Object.create({ inherited: 'value' }) as Record<string, unknown>;

    expect(resolveBsonTableField(document, 'inherited')).toEqual({
      kind: 'not-set',
      value: undefined,
    });
  });

  it('keeps BSON rendering and bounded cell previews', () => {
    const objectId = new ObjectId('507f1f77bcf86cd799439011');
    const bson = formatBsonTableField(
      resolveBsonTableField({ value: objectId }, 'value'),
      'mongosh',
    );
    const longValue = formatBsonTableField(
      resolveBsonTableField({ value: 'x'.repeat(120) }, 'value'),
      'mongosh',
    );

    expect(bson.fullText).toBe('ObjectId("507f1f77bcf86cd799439011")');
    expect(longValue.fullText).toHaveLength(122);
    expect(longValue.visibleText).toBe(`${'"'}${'x'.repeat(99)}…`);
  });

  it('does not label unavailable or invalid previews as missing fields', () => {
    const unavailableDocument = resolveBsonTableField(null, 'value');
    const unavailablePreview = resolveBsonTableField(
      { $preview: 'partial' },
      'value',
      false,
    );

    expect(unavailableDocument.kind).toBe('unavailable');
    expect(formatBsonTableField(unavailableDocument, 'mongosh').fullText).toBe('null');
    expect(unavailablePreview.kind).toBe('unavailable');
    expect(formatBsonTableField(unavailablePreview, 'mongosh').fullText).toBe('undefined');
  });

  it('renders Not Set as muted text and set values as BSON syntax', () => {
    const missingMarkup = renderToStaticMarkup(createElement(BsonTableCell, {
      field: resolveBsonTableField({}, 'value'),
      mode: 'mongosh',
    }));
    const valueMarkup = renderToStaticMarkup(createElement(BsonTableCell, {
      field: resolveBsonTableField({ value: null }, 'value'),
      mode: 'mongosh',
    }));

    expect(missingMarkup).toContain('data-bson-field-state="not-set"');
    expect(missingMarkup).toContain('color:var(--color-text-muted)');
    expect(missingMarkup).toContain('Not Set');
    expect(valueMarkup).toContain('data-bson-syntax="true"');
    expect(valueMarkup).toContain('null');
    expect(valueMarkup).not.toContain('Not Set');
  });
});
