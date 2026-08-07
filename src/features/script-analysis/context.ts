/**
 * AST-based completion context detection (plan §7 Layer 4, ADR-06).
 * Classifies the cursor position structurally, never by keyword matching.
 */
import ts from 'typescript';
import { parseScript, type ScriptLanguage } from './parse.js';

export type DocumentContextKind =
  | 'filter'
  | 'update'
  | 'projection'
  | 'sort'
  | 'document'
  | 'pipeline'
  | 'options'
  | 'unknown';

export type CompletionContext =
  | { kind: 'collection-name' }
  | { kind: 'database-name' }
  | {
      kind: 'document-key';
      docKind: DocumentContextKind;
      collection?: string;
      method?: string;
      pathPrefix?: string;
    }
  | {
      kind: 'operator';
      docKind: 'filter' | 'update';
      operatorScope: 'root' | 'field' | 'update';
      collection?: string;
      method?: string;
    }
  | { kind: 'aggregation-stage'; collection?: string }
  | { kind: 'field-reference'; collection?: string }
  | { kind: 'identifier' };

/** method name -> argument index -> document semantics */
const METHOD_ARG_KINDS: Record<string, Record<number, DocumentContextKind>> = {
  find: { 0: 'filter', 1: 'options' },
  findOne: { 0: 'filter', 1: 'options' },
  countDocuments: { 0: 'filter', 1: 'options' },
  deleteOne: { 0: 'filter', 1: 'options' },
  deleteMany: { 0: 'filter', 1: 'options' },
  updateOne: { 0: 'filter', 1: 'update', 2: 'options' },
  updateMany: { 0: 'filter', 1: 'update', 2: 'options' },
  replaceOne: { 0: 'filter', 1: 'document', 2: 'options' },
  findOneAndUpdate: { 0: 'filter', 1: 'update', 2: 'options' },
  findOneAndReplace: { 0: 'filter', 1: 'document', 2: 'options' },
  findOneAndDelete: { 0: 'filter', 1: 'options' },
  insertOne: { 0: 'document', 1: 'options' },
  insertMany: { 0: 'document', 1: 'options' },
  aggregate: { 0: 'pipeline', 1: 'options' },
  sort: { 0: 'sort' },
  project: { 0: 'projection' },
  watch: { 0: 'pipeline', 1: 'options' },
};

const OPTION_KEY_KINDS: Record<string, DocumentContextKind> = {
  projection: 'projection',
  sort: 'sort',
  filter: 'filter',
  update: 'update',
  pipeline: 'pipeline',
};

const STAGE_KEY_KINDS: Record<string, DocumentContextKind> = {
  $match: 'filter',
  $sort: 'sort',
  $project: 'projection',
  $set: 'document',
  $addFields: 'document',
};

export function detectCompletionContext(
  source: string,
  offset: number,
  language: ScriptLanguage = 'typescript',
): CompletionContext {
  const parsed = parseScript(source, language);
  const sf = parsed.sourceFile;
  const node = findDeepestNode(sf, sf, offset);
  if (!node) return { kind: 'identifier' };

  // --- String-literal positions: collection / database names -------------
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const parent = node.parent;
    if (parent && ts.isCallExpression(parent)) {
      const callee = calleeName(parent);
      if (callee === 'collection' || callee === 'getCollection') return { kind: 'collection-name' };
      if (callee === 'use') return { kind: 'database-name' };
      if (callee === 'db' && receiverText(parent).endsWith('client')) return { kind: 'database-name' };
    }
    if (node.text.startsWith('$') && !node.text.startsWith('$$')) {
      const collection = pipelineCollectionForNode(node);
      if (collection) return { kind: 'field-reference', collection };
    }
    // A string used as a document VALUE is not a key position.
    return { kind: 'identifier' };
  }

  // --- Key positions inside object literals ------------------------------
  const keyInfo = keyPositionInfo(sf, node, offset);
  if (!keyInfo) return { kind: 'identifier' };
  const { objectLiteral, typedPrefix } = keyInfo;

  const callCtx = enclosingDataCall(objectLiteral);
  if (!callCtx) return { kind: 'identifier' };

  // Aggregation stage: object literal is a DIRECT element of the pipeline array.
  if (callCtx.docKind === 'pipeline' && isDirectStageObject(objectLiteral, callCtx)) {
    return { kind: 'aggregation-stage', ...(callCtx.collection ? { collection: callCtx.collection } : {}) };
  }

  const docKind = refinedDocKind(objectLiteral, callCtx.docKind);
  const pathPrefix = fieldPathPrefix(objectLiteral, callCtx);
  if (typedPrefix.startsWith('$') && (docKind === 'filter' || docKind === 'update')) {
    return {
      kind: 'operator',
      docKind,
      operatorScope: docKind === 'update' ? 'update' : pathPrefix ? 'field' : 'root',
      ...(callCtx.collection ? { collection: callCtx.collection } : {}),
      ...(callCtx.method ? { method: callCtx.method } : {}),
    };
  }
  return {
    kind: 'document-key',
    docKind,
    ...(callCtx.collection ? { collection: callCtx.collection } : {}),
    ...(callCtx.method ? { method: callCtx.method } : {}),
    ...(pathPrefix ? { pathPrefix } : {}),
  };
}

interface KeyPositionInfo {
  objectLiteral: ts.ObjectLiteralExpression;
  typedPrefix: string;
}

/** Determine whether the offset sits at a KEY position of an object literal. */
function keyPositionInfo(
  sf: ts.SourceFile,
  node: ts.Node,
  offset: number,
): KeyPositionInfo | null {
  // Case A: node is (part of) a PropertyAssignment name.
  let cursor: ts.Node | undefined = node;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    const p = node.parent;
    if (p && ts.isPropertyAssignment(p) && p.name === node) {
      const obj = p.parent;
      if (obj && ts.isObjectLiteralExpression(obj)) {
        return { objectLiteral: obj, typedPrefix: node.getText(sf) };
      }
    }
    // Shorthand property { foo } behaves like a key.
    if (p && ts.isShorthandPropertyAssignment(p)) {
      const obj = p.parent;
      if (obj && ts.isObjectLiteralExpression(obj)) {
        return { objectLiteral: obj, typedPrefix: node.getText(sf) };
      }
    }
  }
  // Case B: node IS an object literal (cursor on empty/new key position).
  while (cursor) {
    if (ts.isObjectLiteralExpression(cursor)) {
      return { objectLiteral: cursor, typedPrefix: '' };
    }
    // Stop climbing at value positions: only climb through structural nodes.
    const parent: ts.Node | undefined = cursor.parent;
    if (
      parent &&
      (ts.isPropertyAssignment(parent) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isCallExpression(parent))
    ) {
      cursor = parent;
      continue;
    }
    break;
  }
  return null;
}

interface DataCallContext {
  docKind: DocumentContextKind;
  method?: string;
  collection?: string;
  pipelineArray?: ts.ArrayLiteralExpression;
  argumentRoot: ts.Expression;
}

/** Find the enclosing driver data-method call that governs this object. */
function enclosingDataCall(objectLiteral: ts.ObjectLiteralExpression): DataCallContext | null {
  let node: ts.Node = objectLiteral;
  let pipelineArray: ts.ArrayLiteralExpression | undefined;

  while (node.parent) {
    const parent: ts.Node = node.parent;
    if (ts.isArrayLiteralExpression(parent)) {
      pipelineArray = parent;
    }
    if (ts.isCallExpression(parent)) {
      const method = calleeName(parent);
      if (method && method in METHOD_ARG_KINDS) {
        const argIndex = parent.arguments.findIndex((a) => containsNode(a, objectLiteral));
        if (argIndex >= 0) {
          const kinds = METHOD_ARG_KINDS[method]!;
          let docKind: DocumentContextKind = kinds[argIndex] ?? 'unknown';
          // A pipeline array encountered while climbing overrides arg-kind
          // only for the stage objects themselves (handled by caller).
          if (docKind === 'pipeline' && pipelineArray) {
            return {
              docKind,
              method,
              collection: collectionOfCall(parent),
              pipelineArray,
              argumentRoot: parent.arguments[argIndex]!,
            };
          }
          return {
            docKind,
            method,
            collection: collectionOfCall(parent),
            argumentRoot: parent.arguments[argIndex]!,
          };
        }
      }
    }
    node = parent;
  }
  return null;
}

/** Stage objects are direct elements of the aggregate() pipeline array. */
function isDirectStageObject(
  objectLiteral: ts.ObjectLiteralExpression,
  ctx: DataCallContext,
): boolean {
  return Boolean(
    ctx.pipelineArray &&
      ctx.pipelineArray.elements.some(
        (el) => el === objectLiteral || (ts.isParenthesizedExpression(el) && el.expression === objectLiteral),
      ),
  );
}

/** Option-key nesting refines the doc kind: find({}, { projection: {<here>} }). */
function refinedDocKind(
  objectLiteral: ts.ObjectLiteralExpression,
  base: DocumentContextKind,
): DocumentContextKind {
  let node: ts.Node | undefined = objectLiteral.parent;
  while (node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name;
      const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
      if (key && key in OPTION_KEY_KINDS) {
        const kind = OPTION_KEY_KINDS[key]!;
        // 'filter'/'update' option keys refine only when base is options/unknown.
        if (base === 'options' || base === 'unknown' || kind === 'projection' || kind === 'sort') {
          return kind;
        }
        return base;
      }
      if (key && key in STAGE_KEY_KINDS && base === 'pipeline') {
        return STAGE_KEY_KINDS[key]!;
      }
    }
    if (ts.isCallExpression(node)) break;
    node = node.parent;
  }
  return base;
}

/** Field path represented by nested object literals, excluding operators/options. */
function fieldPathPrefix(
  objectLiteral: ts.ObjectLiteralExpression,
  ctx: DataCallContext,
): string | undefined {
  const segments: string[] = [];
  let node: ts.Node = objectLiteral;
  while (node !== ctx.argumentRoot && node.parent) {
    const parent: ts.Node = node.parent;
    if (ts.isPropertyAssignment(parent) && containsNode(parent.initializer, node)) {
      const key = propertyName(parent.name);
      if (
        key &&
        !key.startsWith('$') &&
        !(key in OPTION_KEY_KINDS) &&
        !(key in STAGE_KEY_KINDS)
      ) {
        segments.unshift(key);
      }
    }
    node = parent;
  }
  return segments.length > 0 ? segments.join('.') : undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function receiverText(call: ts.CallExpression): string {
  const expr = call.expression;
  if (ts.isPropertyAccessExpression(expr)) return expr.expression.getText();
  return '';
}

function pipelineCollectionForNode(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isCallExpression(parent)) {
      const method = calleeName(parent);
      if (method === 'aggregate' || method === 'watch') {
        const pipeline = parent.arguments[0];
        if (pipeline && containsNode(pipeline, node)) return collectionOfCall(parent);
      }
    }
    current = parent;
  }
  return undefined;
}

/** Resolve direct/chained collection calls and local aliases through the AST. */
function collectionOfCall(call: ts.CallExpression): string | undefined {
  const expression = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : undefined;
  if (!expression) return undefined;
  return collectionOfExpression(expression, call.getSourceFile(), call.getStart(), new Set(), 0);
}

function collectionOfExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  before: number,
  resolving: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 12) return undefined;
  if (ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) {
    return collectionOfExpression(expression.expression, sourceFile, before, resolving, depth + 1);
  }
  if (ts.isCallExpression(expression)) {
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const method = expression.expression.name.text;
      if (method === 'collection' || method === 'getCollection') {
        const name = expression.arguments[0];
        return name && (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
          ? name.text
          : undefined;
      }
      return collectionOfExpression(
        expression.expression.expression,
        sourceFile,
        before,
        resolving,
        depth + 1,
      );
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return collectionOfExpression(expression.expression, sourceFile, before, resolving, depth + 1);
  }
  if (ts.isIdentifier(expression)) {
    if (resolving.has(expression.text)) return undefined;
    const initializer = latestVariableInitializer(sourceFile, expression.text, before);
    if (!initializer) return undefined;
    resolving.add(expression.text);
    const resolved = collectionOfExpression(
      initializer,
      sourceFile,
      initializer.getStart(),
      resolving,
      depth + 1,
    );
    resolving.delete(expression.text);
    return resolved;
  }
  return undefined;
}

function latestVariableInitializer(
  sourceFile: ts.SourceFile,
  name: string,
  before: number,
): ts.Expression | undefined {
  let latest: { position: number; initializer: ts.Expression } | undefined;
  const visit = (node: ts.Node): void => {
    const position = node.getStart(sourceFile);
    if (position >= before) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (!latest || position > latest.position)
    ) {
      latest = { position, initializer: node.initializer };
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return latest?.initializer;
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  if (root === target) return true;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n === target) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function findDeepestNode(sf: ts.SourceFile, root: ts.Node, pos: number): ts.Node | undefined {
  if (pos < root.getStart(sf) || pos > root.getEnd()) return undefined;
  let result: ts.Node = root;
  const visit = (n: ts.Node): void => {
    ts.forEachChild(n, (child) => {
      if (pos >= child.getStart(sf) && pos <= child.getEnd()) {
        result = child;
        visit(child);
      }
    });
  };
  visit(root);
  return result;
}
