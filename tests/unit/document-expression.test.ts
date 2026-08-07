import { describe, expect, it } from 'vitest';
import {
  DocumentExpressionError,
  parseDocumentExpression,
} from '../../src/features/script-analysis/index.js';

describe('safe document expressions', () => {
  it('normalizes unquoted keys, single quotes, comments, trailing commas, and nested arrays', () => {
    const parsed = parseDocumentExpression(`{
      // query criteria
      bikeid: 17827,
      status: 'ready',
      score: { $gte: -2.5, },
      tags: ['a', true, null,],
    }`, 'Filter');

    expect(JSON.parse(parsed.json)).toEqual({
      bikeid: 17827,
      status: 'ready',
      score: { $gte: -2.5 },
      tags: ['a', true, null],
    });
  });

  it('preserves canonical Extended JSON objects and prototype-named fields as data', () => {
    const parsed = parseDocumentExpression(`{
      _id: { $oid: '507f1f77bcf86cd799439011' },
      __proto__: { safe: true },
      constructor: 'field',
    }`);
    const value = JSON.parse(parsed.json) as Record<string, unknown>;
    expect(value._id).toEqual({ $oid: '507f1f77bcf86cd799439011' });
    expect(value.__proto__).toEqual({ safe: true });
    expect(value.constructor).toBe('field');
  });

  it.each([
    ['call', '{ value: ObjectId("507f1f77bcf86cd799439011") }'],
    ['new expression', '{ value: new Date() }'],
    ['regex', '{ value: /bike/i }'],
    ['spread', '{ ...other }'],
    ['computed property', '{ ["value"]: 1 }'],
    ['shorthand property', '{ value }'],
    ['template expression', '{ value: `x${name}` }'],
    ['top-level array', '[{ value: 1 }]'],
    ['MongoDB $where operator', "{ $where: 'return true' }"],
    ['nested MongoDB $function operator', "{ $expr: { $function: { body: 'return true' } } }"],
  ])('rejects %s without evaluating it', (_label, source) => {
    expect(() => parseDocumentExpression(source, 'Filter')).toThrow(DocumentExpressionError);
  });

  it('reports source-relative ranges for invalid values', () => {
    try {
      parseDocumentExpression('{ safe: 1, unsafe: run() }', 'Filter');
      throw new Error('Expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentExpressionError);
      expect(error).toMatchObject({ start: 19, end: 24 });
    }
  });
});
