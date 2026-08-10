/**
 * AST instrumentation (ADR-06, plan §H).
 *
 * Rebuilds the user's program so every TOP-LEVEL ExpressionStatement is
 * captured:  `expr;`  ->  `await __capture(<index>, ( expr ));`
 *
 * Everything else (declarations, control flow) passes through verbatim so
 * JavaScript semantics — variable scoping, hoisting, side effects — are
 * untouched. The whole program runs inside one async function so top-level
 * await and shared variables between statements just work.
 */
import ts from 'typescript';
import type { SourceRange } from '../../shared/errors/index.js';
import { toRange, type ParsedScript, type TopLevelStatement } from './parse.js';

export interface PromiseProbe {
  id: number;
  statementIndex: number;
  bindingName: string;
  range: SourceRange;
  fixRange: SourceRange;
}

export interface InstrumentedProgram {
  /** Full runnable source (async IIFE). */
  code: string;
  /** Statements whose value will be captured as results. */
  capturedStatementIndexes: number[];
  /** Runtime checks for unresolved Promise values assigned by the main script. */
  promiseProbes: PromiseProbe[];
}

const CAPTURE_FN = '__mongogCapture';
const MARK_FN = '__mongogMark';
const INSPECT_PROMISE_FN = '__mongogInspectPromise';
const PROMISE_WARNING_SUPPRESSION = 'mongog-ignore-next-line no-unawaited-promise';

export function buildInstrumentedSource(
  source: string,
  parsed: ParsedScript,
): InstrumentedProgram {
  const parts: string[] = [];
  const captured: number[] = [];
  const promiseProbes: PromiseProbe[] = [];
  let cursor = 0;

  for (const stmt of parsed.statements) {
    // Preserve any trivia (comments/whitespace) between statements.
    parts.push(source.slice(cursor, stmt.start));
    const probes = promiseProbesForStatement(source, parsed, stmt, promiseProbes.length);
    promiseProbes.push(...probes);
    if (stmt.kind === 'expression') {
      captured.push(stmt.index);
      // Statement text includes the trailing semicolon; strip it before
      // wrapping in a parenthesized thunk (a ';' there is a syntax error).
      const expr = stmt.text.replace(/;+\s*$/, '');
      // Thunk form gives the engine precise per-statement timing. The thunk
      // is invoked (and awaited) immediately at the original statement
      // position, so evaluation order and semantics are unchanged.
      parts.push(`await ${CAPTURE_FN}(${stmt.index}, async () => (\n${expr}\n));`);
    } else {
      // Cheap position marker so runtime errors in declarations/control flow
      // can still be attributed to an exact statement range.
      parts.push(`${MARK_FN}(${stmt.index});\n${stmt.text}`);
    }
    for (const probe of probes) {
      parts.push(`\n${INSPECT_PROMISE_FN}(${probe.id}, ${probe.bindingName});`);
    }
    cursor = stmt.end;
  }
  parts.push(source.slice(cursor));

  const body = parts.join('');
  const code = `(async () => {\n${body}\n})()`;
  return { code, capturedStatementIndexes: captured, promiseProbes };
}

function promiseProbesForStatement(
  source: string,
  parsed: ParsedScript,
  statement: TopLevelStatement,
  firstId: number,
): PromiseProbe[] {
  const node = parsed.sourceFile.statements[statement.index];
  if (!node || isPromiseWarningSuppressed(source, parsed.sourceFile, node)) return [];

  const candidates: Array<{ bindingName: string; expression: ts.Expression }> = [];
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (
        declaration.initializer &&
        ts.isIdentifier(declaration.name) &&
        !isExplicitlyAwaited(declaration.initializer)
      ) {
        candidates.push({ bindingName: declaration.name.text, expression: declaration.initializer });
      }
    }
  } else if (ts.isExpressionStatement(node)) {
    const expression = unwrapExpression(node.expression);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expression.left) &&
      !isExplicitlyAwaited(expression.right)
    ) {
      candidates.push({ bindingName: expression.left.text, expression: expression.right });
    }
  }

  return candidates.map(({ bindingName, expression }, offset) => {
    const start = expression.getStart(parsed.sourceFile);
    return {
      id: firstId + offset,
      statementIndex: statement.index,
      bindingName,
      range: toRange(parsed.sourceFile, start, expression.getEnd()),
      fixRange: toRange(parsed.sourceFile, start, start),
    };
  });
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isExplicitlyAwaited(expression: ts.Expression): boolean {
  return ts.isAwaitExpression(unwrapExpression(expression));
}

function isPromiseWarningSuppressed(
  source: string,
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
): boolean {
  const statementLine = ts.getLineAndCharacterOfPosition(
    sourceFile,
    statement.getStart(sourceFile),
  ).line;
  if (statementLine === 0) return false;
  const previousLine = source.split(/\r?\n/u)[statementLine - 1]?.trim() ?? '';
  return previousLine.includes(PROMISE_WARNING_SUPPRESSION);
}

/** Statements a user can "run" individually (expression or any statement). */
export function isRunnableStatement(stmt: TopLevelStatement): boolean {
  return stmt.kind !== 'other';
}
