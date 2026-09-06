import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { tokenizeBsonSyntax } from '../../../src/renderer/bson-syntax.js';
import { BsonSyntaxText } from '../../../src/renderer/components/Common/BsonSyntaxText.js';

describe('BSON syntax highlighting', () => {
  it('classifies mongosh constructors, properties, strings, numbers, and keywords', () => {
    const source = '{ _id: ObjectId("507f1f77bcf86cd799439011"), count: 8, active: true }';
    const tokens = tokenizeBsonSyntax(source);

    expect(tokens).toContainEqual({ kind: 'property', text: '_id' });
    expect(tokens).toContainEqual({ kind: 'constructor', text: 'ObjectId' });
    expect(tokens).toContainEqual({ kind: 'string', text: '"507f1f77bcf86cd799439011"' });
    expect(tokens).toContainEqual({ kind: 'property', text: 'count' });
    expect(tokens).toContainEqual({ kind: 'number', text: '8' });
    expect(tokens).toContainEqual({ kind: 'keyword', text: 'true' });
    expect(reconstruct(tokens)).toBe(source);
  });

  it('recognizes relaxed and canonical EJSON fields and dollar operators', () => {
    const source = '{"price":{"$numberDecimal":"1492.00"},"count":{"$numberInt":"8"}}';
    const tokens = tokenizeBsonSyntax(source);

    expect(tokens).toContainEqual({ kind: 'property', text: '"price"' });
    expect(tokens).toContainEqual({ kind: 'operator', text: '"$numberDecimal"' });
    expect(tokens).toContainEqual({ kind: 'string', text: '"1492.00"' });
    expect(tokens).toContainEqual({ kind: 'operator', text: '"$numberInt"' });
    expect(reconstruct(tokens)).toBe(source);
  });

  it('separates escapes and safely handles a truncated string', () => {
    const escaped = '"line\\n\\"two"';
    const escapedTokens = tokenizeBsonSyntax(escaped);
    expect(escapedTokens.filter((token) => token.kind === 'escape').map((token) => token.text))
      .toEqual(['\\n', '\\"']);
    expect(reconstruct(escapedTokens)).toBe(escaped);

    const truncated = 'ObjectId("507f1f';
    expect(reconstruct(tokenizeBsonSyntax(truncated))).toBe(truncated);
  });

  it('renders user content as escaped React text with matching visible content', () => {
    const text = '"<img src=x onerror=alert(1)>"';
    const markup = renderToStaticMarkup(createElement(BsonSyntaxText, { text, title: text }));

    expect(markup).toContain('data-bson-syntax="true"');
    expect(markup).toContain('data-bson-token="string"');
    expect(markup).toContain('color:var(--color-syntax-string)');
    expect(markup).toContain('&lt;img');
    expect(markup).not.toContain('<img');
    expect(reconstruct(tokenizeBsonSyntax(text))).toBe(text);
  });
});

function reconstruct(tokens: ReturnType<typeof tokenizeBsonSyntax>): string {
  return tokens.map((token) => token.text).join('');
}
