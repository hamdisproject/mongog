import ts from 'typescript';
import {
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  EJSON,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'bson';

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
 * evaluated. Only explicitly allowlisted mongosh BSON constructors with
 * static literal arguments are converted to typed BSON values. The output is
 * canonical EJSON so the runtime can deserialize it without type loss.
 */
export function parseDocumentExpression(
  source: string,
  label = 'Expression',
): ParsedDocumentExpression {
  const { sourceFile, root } = parseRootExpression(source, label, 'one object literal');
  if (!ts.isObjectLiteralExpression(root)) {
    throw expressionError(sourceFile, root, source.length, `${label} must be an object literal.`);
  }

  const value = convertObject(sourceFile, root, source.length, label);
  return { json: JSON.stringify(toCanonicalJsonData(value)) };
}

/** Parses any safe literal/BSON value without evaluating user-provided code. */
export function parseValueExpression(
  source: string,
  label = 'Value',
): ParsedDocumentExpression {
  const { sourceFile, root } = parseRootExpression(source, label, 'one value');
  const value = convertValue(sourceFile, root, source.length, label);
  return { json: JSON.stringify(toCanonicalJsonData(value)) };
}

/** Parses an array whose entries must all be document object literals. */
export function parseDocumentArrayExpression(
  source: string,
  label = 'Documents',
): ParsedDocumentExpression {
  const { sourceFile, root } = parseRootExpression(source, label, 'one document array');
  if (!ts.isArrayLiteralExpression(root)) {
    throw expressionError(sourceFile, root, source.length, `${label} must be an array of document objects.`);
  }
  const documents = root.elements.map((element) => {
    if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
      throw expressionError(
        sourceFile,
        element,
        source.length,
        `${label} does not allow array holes or spread elements.`,
      );
    }
    const entry = unwrapParentheses(element);
    if (!ts.isObjectLiteralExpression(entry)) {
      throw expressionError(sourceFile, entry, source.length, `${label} entries must be document objects.`);
    }
    return convertObject(sourceFile, entry, source.length, label);
  });
  return { json: JSON.stringify(toCanonicalJsonData(documents)) };
}

function parseRootExpression(
  source: string,
  label: string,
  expected: string,
): { sourceFile: ts.SourceFile; root: ts.Expression } {
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
    throw new DocumentExpressionError(`${label} must be ${expected}.`, 0, Math.max(1, source.length));
  }

  const root = unwrapParentheses(statement.expression);
  return { sourceFile, root };
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
  if (ts.isRegularExpressionLiteral(node)) {
    return convertRegexLiteral(sourceFile, node, sourceLength, label);
  }
  if (ts.isCallExpression(node)) {
    return convertBsonConstructor(sourceFile, node, node.expression, node.arguments, sourceLength, label, false);
  }
  if (ts.isNewExpression(node)) {
    return convertBsonConstructor(
      sourceFile,
      node,
      node.expression,
      node.arguments ?? ts.factory.createNodeArray(),
      sourceLength,
      label,
      true,
    );
  }
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

const BSON_CONSTRUCTOR_NAMES = new Set([
  'ObjectId', 'ISODate', 'Int32', 'NumberInt', 'Long', 'NumberLong', 'Double',
  'Decimal128', 'NumberDecimal', 'BinData', 'UUID', 'BSONRegExp', 'Timestamp',
  'MinKey', 'MaxKey', 'DBRef', 'Code', 'BSONSymbol',
]);

function convertBsonConstructor(
  sourceFile: ts.SourceFile,
  callNode: ts.CallExpression | ts.NewExpression,
  expression: ts.LeftHandSideExpression,
  args: readonly ts.Expression[],
  sourceLength: number,
  label: string,
  isNew: boolean,
): unknown {
  if (!ts.isIdentifier(expression)) {
    throw expressionError(sourceFile, callNode, sourceLength, `${label} does not allow method calls.`);
  }
  const name = expression.text;
  if (isNew && name !== 'Date') {
    throw expressionError(
      sourceFile,
      callNode,
      sourceLength,
      `${label} only allows new Date(…) as a constructor expression.`,
    );
  }
  if (!isNew && !BSON_CONSTRUCTOR_NAMES.has(name)) {
    throw expressionError(
      sourceFile,
      callNode,
      sourceLength,
      `${label} does not allow the executable call ${name}(…).`,
    );
  }

  try {
    switch (name) {
      case 'ObjectId':
        expectArgCount(name, args, 1);
        return new ObjectId(expectString(name, args[0]));
      case 'ISODate':
      case 'Date': {
        expectArgCount(name, args, 1);
        const value = new Date(expectString(name, args[0]));
        if (Number.isNaN(value.getTime())) throw new Error('requires a valid ISO date string');
        return value;
      }
      case 'Int32':
      case 'NumberInt': {
        expectArgCount(name, args, 1);
        const value = staticScalar(sourceFile, args[0], sourceLength, label);
        return typeof value === 'string' ? Int32.fromString(value) : new Int32(expectIntegerValue(name, value));
      }
      case 'Long':
      case 'NumberLong': {
        expectArgCount(name, args, 1);
        const value = staticScalar(sourceFile, args[0], sourceLength, label);
        if (typeof value === 'string') return Long.fromString(value);
        return Long.fromNumber(expectSafeIntegerValue(name, value));
      }
      case 'Double': {
        expectArgCount(name, args, 1);
        const value = staticScalar(sourceFile, args[0], sourceLength, label);
        return typeof value === 'string' ? Double.fromString(value) : new Double(expectNumberValue(name, value));
      }
      case 'Decimal128':
      case 'NumberDecimal':
        expectArgCount(name, args, 1);
        return Decimal128.fromString(expectString(name, args[0]));
      case 'BinData': {
        expectArgCount(name, args, 2);
        const subtype = expectInteger(name, args[0], sourceFile, sourceLength, label);
        if (subtype < 0 || subtype > 255) throw new Error('subtype must be between 0 and 255');
        return Binary.createFromBase64(expectString(name, args[1]), subtype);
      }
      case 'UUID': {
        expectArgCount(name, args, 1);
        const value = expectString(name, args[0]);
        if (!UUID.isValid(value)) throw new Error('requires a valid UUID string');
        return new UUID(value);
      }
      case 'BSONRegExp': {
        expectArgRange(name, args, 1, 2);
        return new BSONRegExp(expectString(name, args[0]), args[1] ? expectString(name, args[1]) : '');
      }
      case 'Timestamp': {
        expectArgCount(name, args, 1);
        const value = convertStaticArgument(sourceFile, args[0]!, sourceLength, label);
        if (!isRecord(value)) throw new Error('requires an object with numeric t and i fields');
        const t = expectUnsignedInt32(`${name}.t`, value.t);
        const i = expectUnsignedInt32(`${name}.i`, value.i);
        return new Timestamp({ t, i });
      }
      case 'MinKey':
        expectArgCount(name, args, 0);
        return new MinKey();
      case 'MaxKey':
        expectArgCount(name, args, 0);
        return new MaxKey();
      case 'DBRef': {
        expectArgRange(name, args, 2, 4);
        const collection = expectString(name, args[0]);
        const oid = convertStaticArgument(sourceFile, args[1]!, sourceLength, label);
        if (!(oid instanceof ObjectId)) throw new Error('second argument must be ObjectId(…)');
        const database = args[2] && !isUndefinedIdentifier(args[2]) ? expectString(name, args[2]) : undefined;
        const fields = args[3] ? convertStaticArgument(sourceFile, args[3], sourceLength, label) : undefined;
        if (fields !== undefined && !isRecord(fields)) throw new Error('fourth argument must be an object literal');
        return new DBRef(collection, oid, database, fields);
      }
      case 'Code': {
        expectArgRange(name, args, 1, 2);
        const code = expectString(name, args[0]);
        const scope = args[1] ? convertStaticArgument(sourceFile, args[1], sourceLength, label) : undefined;
        if (scope !== undefined && !isRecord(scope)) throw new Error('scope must be an object literal');
        return new Code(code, scope);
      }
      case 'BSONSymbol':
        expectArgCount(name, args, 1);
        return new BSONSymbol(expectString(name, args[0]));
      default:
        throw new Error('is not supported');
    }
  } catch (error) {
    if (error instanceof DocumentExpressionError) throw error;
    throw expressionError(
      sourceFile,
      callNode,
      sourceLength,
      `${name}(…) ${(error as Error).message}.`,
    );
  }
}

function convertRegexLiteral(
  sourceFile: ts.SourceFile,
  node: ts.RegularExpressionLiteral,
  sourceLength: number,
  label: string,
): BSONRegExp {
  const text = node.text;
  const separator = text.lastIndexOf('/');
  if (!text.startsWith('/') || separator <= 0) {
    throw expressionError(sourceFile, node, sourceLength, `${label} contains an invalid regular expression literal.`);
  }
  try {
    return new BSONRegExp(text.slice(1, separator), text.slice(separator + 1));
  } catch (error) {
    throw expressionError(sourceFile, node, sourceLength, `${label} contains an invalid BSON regex: ${(error as Error).message}.`);
  }
}

function convertStaticArgument(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  sourceLength: number,
  label: string,
): unknown {
  return convertValue(sourceFile, node, sourceLength, label);
}

function staticScalar(
  sourceFile: ts.SourceFile,
  node: ts.Expression | undefined,
  sourceLength: number,
  label: string,
): unknown {
  if (!node) throw new Error('requires an argument');
  const value = convertValue(sourceFile, node, sourceLength, label);
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('requires a string or number literal');
  return value;
}

function expectString(name: string, node: ts.Expression | undefined): string {
  const unwrapped = node && unwrapParentheses(node);
  if (!unwrapped || !ts.isStringLiteral(unwrapped)) throw new Error(`${name} requires a string literal`);
  return unwrapped.text;
}

function expectInteger(
  name: string,
  node: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  sourceLength: number,
  label: string,
): number {
  if (!node) throw new Error(`${name} requires a numeric literal`);
  return expectIntegerValue(name, convertValue(sourceFile, node, sourceLength, label));
}

function expectNumberValue(name: string, value: unknown): number {
  if (typeof value !== 'number') throw new Error(`${name} requires a numeric literal`);
  return value;
}

function expectIntegerValue(name: string, value: unknown): number {
  const number = expectNumberValue(name, value);
  if (!Number.isInteger(number)) throw new Error(`${name} requires an integer literal`);
  return number;
}

function expectSafeIntegerValue(name: string, value: unknown): number {
  const number = expectIntegerValue(name, value);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} numeric input must be a safe integer; use a string for 64-bit values`);
  return number;
}

function expectUnsignedInt32(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
  return value;
}

function expectArgCount(name: string, args: readonly unknown[], count: number): void {
  if (args.length !== count) throw new Error(`requires exactly ${count} argument${count === 1 ? '' : 's'}`);
}

function expectArgRange(name: string, args: readonly unknown[], min: number, max: number): void {
  if (args.length < min || args.length > max) throw new Error(`requires ${min}-${max} arguments`);
}

function isUndefinedIdentifier(node: ts.Expression): boolean {
  const value = unwrapParentheses(node);
  return ts.isIdentifier(value) && value.text === 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCanonicalJsonData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCanonicalJsonData);
  if (value instanceof Date || (isRecord(value) && typeof value._bsontype === 'string')) {
    return JSON.parse(EJSON.stringify(value, undefined, 0, { relaxed: false })) as unknown;
  }
  if (isRecord(value)) {
    const result = Object.create(null) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        value: toCanonicalJsonData(nested),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return value;
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
