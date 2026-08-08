import { memo, useMemo } from 'react';
import {
  tokenizeBsonSyntax,
  type BsonSyntaxTokenKind,
} from '../../bson-syntax.js';

export interface BsonSyntaxTextProps {
  text: string;
  title?: string;
}

const tokenColors: Record<BsonSyntaxTokenKind, string | undefined> = {
  plain: undefined,
  property: 'var(--color-syntax-property)',
  string: 'var(--color-syntax-string)',
  escape: 'var(--color-syntax-escape)',
  number: 'var(--color-syntax-number)',
  constructor: 'var(--color-syntax-constructor)',
  keyword: 'var(--color-syntax-keyword)',
  operator: 'var(--color-syntax-operator)',
  delimiter: 'var(--color-syntax-delimiter)',
};

/** Lightweight syntax rendering for bounded table-cell previews. */
export const BsonSyntaxText = memo(function BsonSyntaxText({ text, title }: BsonSyntaxTextProps) {
  const tokens = useMemo(() => tokenizeBsonSyntax(text), [text]);
  return (
    <span
      data-bson-syntax="true"
      title={title}
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      {tokens.map((token, index) => (
        <span
          key={`${index}:${token.kind}`}
          data-bson-token={token.kind}
          style={tokenColors[token.kind] ? { color: tokenColors[token.kind] } : undefined}
        >
          {token.text}
        </span>
      ))}
    </span>
  );
});
