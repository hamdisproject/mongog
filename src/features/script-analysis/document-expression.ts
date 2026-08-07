import ts from 'typescript';

export interface ParsedDocumentExpression {
  /** Strict JSON ready for BSON EJSON deserialization in the query runtime. */
  json: string;
}

export class DocumentExpressionError extends Error {
  readonly start: number;
  readonly end: number;

  constructor(message: string, start: number, end: number) {
    super(message);
    this.name = 'DocumentExpressionError';
    this.start = start;
    this.end = end;
  }
}

const EXECUTABLE_DOCUMENT_OPERATORS = new Set(['$where', '$function', '$accumulator']);

/**
 * Parses a JavaScript-style object literal as DATA only. No expression is
 * evaluated and no identifier, call, constructor, spread, or computed key is
 * accepted. The output is strict JSON so the runtime can apply BSON EJSON
 * semantics after this pure syntax step.
 */
export function parseDocumentExpression(
  source: string,
  label = 'Expression',
): ParsedDocumentExpression {
  if (!source.trim()) {
    throw new DocumentExpressionError(`${label} cannot be empty.`, 0, Math.max(1, source.length));
  }

  const wrapped = `(${source}\n)`;
  const sourceFile = ts.createSourceFile(
    'document-expression.ts',
    wrapped,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  const diagnostic = parseDiagnostics[0];
  if (diagnostic) {
    const start = sourceOffset(diagnostic.start ?? 1, source.length);
    const end = sourceOffset((diagnostic.start ?? 1) + Math.max(1, diagnostic.length ?? 1), source.length);
    throw new DocumentExpressionError(
      `${label} has invalid syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
      start,
      Math.max(start + 1, end),
    );
  }

  const statement = sourceFile.statements[0];
  if (
    sourceFile.statements.length !== 1 ||
    !statement ||
    !ts.isExpressionStatement(statement)
  ) {
    throw new DocumentExpressionError(`${label} must be one object literal.`, 0, Math.max(1, source.length));
  }

  const root = unwrapParentheses(statement.expression);
  if (!ts.isObjectLiteralExpression(root)) {
    throw expressionError(sourceFile, root, source.length, `${label} must be an object literal.`);
  }

  const value = convertObject(sourceFile, root, source.length, label);
  return { json: JSON.stringify(value) };
}

function convertObject(
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
  sourceLength: number,
  label: string,
): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw expressionError(
        sourceFile,
        property,
        sourceLength,
        `${label} supports property assignments only; shorthand, spread, and methods are not allowed.`,
      );
    }
    const key = propertyName(sourceFile, property.name, sourceLength, label);
    if (EXECUTABLE_DOCUMENT_OPERATORS.has(key)) {
      throw expressionError(
        sourceFile,
        property.name,
        sourceLength,
        `${label} does not allow the executable MongoDB operator ${key}.`,
      );
    }
    Object.defineProperty(result, key, {
      value: convertValue(sourceFile, property.initializer, sourceLength, label),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function convertValue(
  sourceFile: ts.SourceFile,
  rawNode: ts.Expression,
  sourceLength: number,
  label: string,
): unknown {
  const node = unwrapParentheses(rawNode);
  if (ts.isObjectLiteralExpression(node)) {
    return convertObject(sourceFile, node, sourceLength, label);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
        throw expressionError(
          sourceFile,
          element,
          sourceLength,
          `${label} does not allow array holes or spread elements.`,
        );
      }
      return convertValue(sourceFile, element, sourceLength, label);
    });
  }
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }

  throw expressionError(
    sourceFile,
    node,
    sourceLength,
    `${label} values must be literal data; executable expressions are not allowed.`,
  );
}

function propertyName(
  sourceFile: ts.SourceFile,
  name: ts.PropertyName,
  sourceLength: number,
  label: string,
): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw expressionError(
    sourceFile,
    name,
    sourceLength,
    `${label} does not allow computed property names.`,
  );
}

function unwrapParentheses<T extends ts.Expression>(node: T): ts.Expression {
  let current: ts.Expression = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function expressionError(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  sourceLength: number,
  message: string,
): DocumentExpressionError {
  const start = sourceOffset(node.getStart(sourceFile), sourceLength);
  const end = sourceOffset(node.getEnd(), sourceLength);
  return new DocumentExpressionError(message, start, Math.max(start + 1, end));
}

function sourceOffset(wrappedOffset: number, sourceLength: number): number {
  return Math.max(0, Math.min(sourceLength, wrappedOffset - 1));
}
