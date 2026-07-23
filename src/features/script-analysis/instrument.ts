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
import type { ParsedScript, TopLevelStatement } from './parse.js';

export interface InstrumentedProgram {
  /** Full runnable source (async IIFE). */
  code: string;
  /** Statements whose value will be captured as results. */
  capturedStatementIndexes: number[];
}

const CAPTURE_FN = '__mongogCapture';
const MARK_FN = '__mongogMark';

export function buildInstrumentedSource(
  source: string,
  parsed: ParsedScript,
): InstrumentedProgram {
  const parts: string[] = [];
  const captured: number[] = [];
  let cursor = 0;

  for (const stmt of parsed.statements) {
    // Preserve any trivia (comments/whitespace) between statements.
    parts.push(source.slice(cursor, stmt.start));
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
    cursor = stmt.end;
  }
  parts.push(source.slice(cursor));

  const body = parts.join('');
  const code = `(async () => {\n${body}\n})()`;
  return { code, capturedStatementIndexes: captured };
}

/** Statements a user can "run" individually (expression or any statement). */
export function isRunnableStatement(stmt: TopLevelStatement): boolean {
  return stmt.kind !== 'other';
}
