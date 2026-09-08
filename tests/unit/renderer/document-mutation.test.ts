import { EJSON, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';

import {
  IMMUTABLE_DOCUMENT_ID_MESSAGE,
  MISSING_DOCUMENT_ID_MESSAGE,
  immutableDocumentIdError,
  prepareDocumentMutation,
} from '../../../src/renderer/document-mutation.js';
import { renderBson } from '../../../src/shared/ejson/index.js';
import { editorBsonCases } from '../../fixtures/bson-editor-corpus.js';

const canonical = (value: unknown) => EJSON.stringify(value, undefined, 0, { relaxed: false });

describe('document mutation preparation', () => {
  it('normalizes an ObjectId constructor to canonical Extended JSON before IPC', () => {
    const prepared = prepareDocumentMutation(`{
      _id: ObjectId("507f1f77bcf86cd799439011"),
      name: "typed",
    }`);

    expect(JSON.parse(prepared.documentEjson)).toEqual({
      _id: { $oid: '507f1f77bcf86cd799439011' },
      name: 'typed',
    });
    const restored = EJSON.parse(prepared.documentEjson, { relaxed: false }) as { _id: unknown };
    expect(restored._id)
      .toBeInstanceOf(ObjectId);
  });

  it('does not coerce a quoted ObjectId-looking value', () => {
    const prepared = prepareDocumentMutation(
      '{ _id: "ObjectId(\\"507f1f77bcf86cd799439011\\")" }',
    );

    const restored = EJSON.parse(prepared.documentEjson, { relaxed: false }) as { _id: unknown };
    expect(restored._id)
      .toBe('ObjectId("507f1f77bcf86cd799439011")');
  });

  it('allows non-id edits while preserving the original ObjectId', () => {
    const original = '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"before"}';
    const prepared = prepareDocumentMutation(
      '{ _id: ObjectId("507f1f77bcf86cd799439011"), name: "after" }',
    );

    expect(immutableDocumentIdError(original, prepared)).toBeNull();
  });

  it('rejects changed and removed immutable ids', () => {
    const original = '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"before"}';
    const changed = prepareDocumentMutation(
      '{ _id: ObjectId("507f1f77bcf86cd799439012"), name: "after" }',
    );
    const removed = prepareDocumentMutation('{ name: "after" }');

    expect(immutableDocumentIdError(original, changed)).toBe(IMMUTABLE_DOCUMENT_ID_MESSAGE);
    expect(immutableDocumentIdError(original, removed)).toBe(MISSING_DOCUMENT_ID_MESSAGE);
  });

  it.each(editorBsonCases)('normalizes $name without BSON type loss before IPC', ({ source, expected }) => {
    const prepared = prepareDocumentMutation(`{ value: ${source} }`);
    const restored = EJSON.parse(prepared.documentEjson, { relaxed: false }) as { value: unknown };

    expect(canonical(restored.value)).toBe(canonical(expected));
  });

  it.each(editorBsonCases)('round-trips $name through editable mongosh rendering', ({ source, expected }) => {
    const prepared = prepareDocumentMutation(`{ value: ${source} }`);
    const restored = EJSON.parse(prepared.documentEjson, { relaxed: false });
    const editable = renderBson(restored, 'mongosh', true, 'editable');
    const reparsed = EJSON.parse(
      prepareDocumentMutation(editable).documentEjson,
      { relaxed: false },
    ) as { value: unknown };

    expect(canonical(reparsed.value)).toBe(canonical(expected));
  });
});
