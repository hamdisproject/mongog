/** Type-only projection of the automatic-await language. Never executed. */
import ts from 'typescript';
import { parseScript } from './parse.js';

export interface SourceMapping {
  originalStart: number;
  generatedStart: number;
  length: number;
}
export interface TransformationDiagnostic { start: number; length: number; message: string }
export interface AutoAwaitProjection {
  source: string;
  mappings: SourceMapping[];
  diagnostics: TransformationDiagnostic[];
  generatedNames: string[];
  toGenerated: (offset: number) => number;
  toOriginal: (offset: number) => number | undefined;
}

export function isPromiseContinuation(node: ts.Expression): boolean {
  return (ts.isPropertyAccessExpression(node) && ['then', 'catch', 'finally'].includes(node.name.text)) ||
    (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && ['then', 'catch', 'finally'].includes(node.argumentExpression.text));
}

/**
 * Runtime conditionally waits at value reads; the language service instead
 * applies Awaited<T> at those reads. This retains the driver's real signatures,
 * overloads, generic arguments and contextual typing without exposing runtime
 * temporaries to the editor. Insertions leave every original character mapped.
 */
export function buildAutoAwaitProjection(source: string): AutoAwaitProjection {
  const { sourceFile, diagnostics } = parseScript(source);
  let name = '__mongogAwait';
  while (source.includes(name)) name += '_';
  const insertions = new Map<number, string[]>();
  const insert = (position: number, value: string) => {
    const items = insertions.get(position) ?? [];
    items.push(value); insertions.set(position, items);
  };
  const wrap = (node: ts.Node, helper = name) => {
    insert(node.getStart(sourceFile), `${helper}(`);
    // Inner closing insertions must precede outer ones; all are parentheses.
    insert(node.end, ')');
  };
  const binding = (node: ts.BindingName) => {
    if (ts.isIdentifier(node)) return;
    for (const item of node.elements) if (ts.isBindingElement(item)) {
      if (item.propertyName && ts.isComputedPropertyName(item.propertyName)) expression(item.propertyName.expression);
      binding(item.name);
      if (item.initializer) expression(item.initializer);
    }
  };
  const target = (node: ts.Expression) => {
    if (ts.isPropertyAccessExpression(node)) expression(node.expression);
    else if (ts.isElementAccessExpression(node)) { expression(node.expression); expression(node.argumentExpression); }
    else if (ts.isParenthesizedExpression(node)) target(node.expression);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      binding(node.name); if (node.initializer) expression(node.initializer); return;
    }
    if (ts.isForOfStatement(node)) {
      visit(node.initializer); wrap(node.expression, `${name}Iterable`); expression(node.expression); visit(node.statement); return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) expression(node.name.expression);
      expression(node.initializer); return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      insert(node.getStart(sourceFile), `${node.name.text}: `); expression(node.name); return;
    }
    if (ts.isPropertyDeclaration(node)) {
      if (node.initializer) expression(node.initializer); return;
    }
    if (ts.isFunctionLike(node) && 'body' in node) {
      if ('name' in node && node.name && ts.isComputedPropertyName(node.name)) expression(node.name.expression);
      for (const parameter of node.parameters) visit(parameter);
      if (node.body) visit(node.body);
      return;
    }
    if (ts.isExpression(node)) { expression(node); return; }
    ts.forEachChild(node, visit);
  };
  const expression = (node: ts.Expression, wait = true, chain = false): void => {
    const optional = ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node) || ts.isCallChain(node);
    if (optional && chain) wait = false;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) { expression(node.expression, wait, chain); return; }
    if (ts.isIdentifier(node)) { if (wait) wrap(node); return; }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassExpression(node)) {
      // Keep parameter contextual typing intact; results in the body already
      // have their awaited types, so ordinary helpers infer synchronous values.
      if (ts.isClassExpression(node)) ts.forEachChild(node, visit);
      else { node.parameters.forEach(visit); visit(node.body); }
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (wait) wrap(node);
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        if (ts.isPropertyAccessExpression(callee) && ['map','reduce','flatMap'].includes(callee.name.text)) wrap(callee.expression, `${name}Array`);
        expression(callee.expression, !isPromiseContinuation(callee), optional);
        if (ts.isElementAccessExpression(callee)) expression(callee.argumentExpression);
      } else expression(callee, false);
      node.arguments?.forEach(argument => {
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) wrap(argument, `${name}Callback`);
        expression(argument);
      });
      return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (wait) wrap(node);
      expression(node.expression, true, optional);
      if (ts.isElementAccessExpression(node)) expression(node.argumentExpression);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const assignment = node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      if (assignment) target(node.left); else expression(node.left);
      expression(node.right); return;
    }
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) { target(node.operand); return; }
    if (ts.isPostfixUnaryExpression(node)) { target(node.operand); return; }
    if (ts.isDeleteExpression(node)) { target(node.expression); return; }
    if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression)) return;
    if (ts.isMetaProperty(node) || node.kind === ts.SyntaxKind.SuperKeyword) return;
    ts.forEachChild(node, visit);
  };
  sourceFile.statements.forEach(visit);

  const prelude = `export {};
type ${name}ArrayResult<T> = T extends readonly (infer V)[] ? Omit<T, 'map' | 'reduce' | 'flatMap'> & {
  map<R>(callback: (value: V, index: number, array: T) => R, thisArg?: unknown): Awaited<R>[];
  flatMap<R>(callback: (value: V, index: number, array: T) => R, thisArg?: unknown): (Awaited<R> extends readonly (infer E)[] ? E : Awaited<R>)[];
  reduce(callback: (previous: V, value: V, index: number, array: T) => V | PromiseLike<V>): V;
  reduce<R>(callback: (previous: R, value: V, index: number, array: T) => R | PromiseLike<R>, initial: R): R;
} : T;
declare function ${name}Array<T>(value: T): ${name}ArrayResult<T>;\ndeclare function ${name}<T>(value: T): Awaited<T>;\ndeclare function ${name}Callback<A extends any[], R>(fn: (...args: A) => R): ((...args: A) => Promise<Awaited<R>>) & ((...args: A) => R);\ndeclare function ${name}Iterable<T>(value: Iterable<T> | AsyncIterable<T>): Iterable<Awaited<T>>;\n`;
  let generated = prelude;
  let cursor = 0;
  const mappings: SourceMapping[] = [];
  for (const [position, values] of [...insertions].sort(([a], [b]) => a - b)) {
    if (position > cursor) {
      mappings.push({ originalStart: cursor, generatedStart: generated.length, length: position - cursor });
      generated += source.slice(cursor, position);
    }
    generated += values.join(''); cursor = position;
  }
  mappings.push({ originalStart: cursor, generatedStart: generated.length, length: source.length - cursor });
  generated += source.slice(cursor);
  return {
    source: generated, mappings, diagnostics: diagnostics.map(item=>({start:item.start,length:item.end-item.start,message:item.message})),
    generatedNames: [name, `${name}Callback`, `${name}Array`, `${name}ArrayResult`, `${name}Iterable`],
    toGenerated(offset) {
      // At a caret boundary prefer the preceding original character, before
      // synthesized closing parentheses (member completion after `user.`).
      const previous = mappings.find(item => offset > item.originalStart && offset <= item.originalStart + item.length);
      const mapping = previous ?? mappings.find(item => item.originalStart === offset);
      return mapping ? mapping.generatedStart + offset - mapping.originalStart : generated.length;
    },
    toOriginal(offset) {
      const mapping = mappings.find(item => offset >= item.generatedStart && offset <= item.generatedStart + item.length);
      return mapping ? mapping.originalStart + offset - mapping.generatedStart : undefined;
    },
  };
}

/** Map TS language-service data without exposing synthetic-only spans. */
export function mapAutoAwaitResult(value: unknown, fileName: string, projectionFor: (name: string) => AutoAwaitProjection | undefined): unknown {
  if (Array.isArray(value)) return value.map(item => mapAutoAwaitResult(item, fileName, projectionFor)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const diagnosticFile = object.file as {fileName?: string} | undefined;
  const targetFile = typeof object.fileName === 'string' ? object.fileName : diagnosticFile?.fileName ?? fileName;
  const projection = projectionFor(targetFile);
  if (!projection) return value;
  if ([object.name, object.text].some(name => typeof name === 'string' && projection.generatedNames.includes(name))) return undefined;
  const copy: Record<string, unknown> = {};
  if (typeof object.start === 'number' && typeof object.length === 'number') {
    const first = projection.toOriginal(object.start) ?? projection.mappings.find(item => item.generatedStart >= (object.start as number) && item.generatedStart < (object.start as number) + (object.length as number))?.originalStart;
    if (first === undefined) return undefined;
    const end = projection.toOriginal(object.start + object.length) ?? first + 1;
    copy.start = first; copy.length = Math.max(0, end - first);
  }
  for (const [key, item] of Object.entries(object)) {
    if (key === 'start' || key === 'length') { if (!(key in copy)) copy[key] = item; continue; }
    // SourceFiles contain cycles; Monaco strips them after this mapping.
    if (key === 'file') { copy[key] = item; continue; }
    if (key === 'position' && typeof item === 'number') { copy[key] = projection.toOriginal(item); continue; }
    const mapped = mapAutoAwaitResult(item, targetFile, projectionFor);
    // Monaco's adapters dereference these mandatory spans. An item entirely
    // inside a synthesized helper has no user-facing counterpart.
    if (mapped === undefined && ['textSpan','triggerSpan','applicableSpan'].includes(key)) return undefined;
    if (key === 'spans' && Array.isArray(mapped) && mapped.length === 0) return undefined;
    copy[key] = mapped;
  }
  return copy;
}
