import { BsonSyntaxText } from './BsonSyntaxText.js';
import {
  renderBson,
  type BsonDisplayMode,
} from '../../../shared/ejson/index.js';

export type BsonTableField =
  | { kind: 'set'; value: unknown }
  | { kind: 'not-set'; value: undefined }
  | { kind: 'unavailable'; value: unknown };

export interface FormattedBsonTableField {
  fullText: string;
  visibleText: string;
  notSet: boolean;
}

export function resolveBsonTableField(
  document: Record<string, unknown> | null,
  column: string,
  fieldsKnown = document !== null,
): BsonTableField {
  if (!fieldsKnown || document === null) {
    return {
      kind: 'unavailable',
      value: document === null ? null : document[column],
    };
  }
  if (!Object.hasOwn(document, column)) return { kind: 'not-set', value: undefined };
  return { kind: 'set', value: document[column] };
}

export function formatBsonTableField(
  field: BsonTableField,
  mode: BsonDisplayMode,
): FormattedBsonTableField {
  if (field.kind === 'not-set') {
    return { fullText: 'Not Set', visibleText: 'Not Set', notSet: true };
  }

  let fullText: string;
  try {
    fullText = renderBson(field.value, mode, false);
  } catch {
    fullText = String(field.value);
  }
  return {
    fullText,
    visibleText: fullText.length > 100 ? `${fullText.slice(0, 100)}…` : fullText,
    notSet: false,
  };
}

export function BsonTableCell({
  field,
  mode,
}: {
  field: BsonTableField;
  mode: BsonDisplayMode;
}) {
  const formatted = formatBsonTableField(field, mode);
  if (formatted.notSet) {
    return (
      <span
        data-bson-field-state="not-set"
        title="Field is not set on this document"
        style={{
          color: 'var(--color-text-muted)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {formatted.visibleText}
      </span>
    );
  }
  return <BsonSyntaxText text={formatted.visibleText} title={formatted.fullText} />;
}
