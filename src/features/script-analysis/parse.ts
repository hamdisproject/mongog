/**
 * AST-based script parsing (ADR-06). This is the ONLY place scripts are
 * analyzed for statement structure. Semicolon/regex splitting is forbidden.
 *
 * Uses the TypeScript compiler in error-tolerant mode so partial/broken
 * scripts still produce a usable AST with diagnostics.
 */
import ts from 'typescript';
import type { SourceRange } from '../../shared/errors/index.js';

export type ScriptLanguage = 'javascript' | 'typescript';

export type TopLevelStatementKind = 'expression' | 'declaration' | 'control' | 'other';

export interface TopLevelStatement {
  index: number;
  kind: TopLevelStatementKind;
  /** 0-based character offsets in the original source. */
  start: number;
  end: number;
  /** 1-based display range (Monaco convention). */
  range: SourceRange;
  /** Original source text of the statement. */
  text: string;
}

export interface ParseDiagnostic {
  message: string;
  range: SourceRange;
  start: number;
  end: number;
}

export interface ParsedScript {
  statements: TopLevelStatement[];
  diagnostics: ParseDiagnostic[];
  /** Internal: kept for context detection; not serialized over IPC. */
  sourceFile: ts.SourceFile;
}

export function parseScript(source: string, language: ScriptLanguage = 'typescript'): ParsedScript {
  const sourceFile = ts.createSourceFile(
    language === 'typescript' ? 'script.ts' : 'script.js',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );

  const statements: TopLevelStatement[] = sourceFile.statements.map((stmt, index) => {
    const start = stmt.getStart(sourceFile);
    const end = stmt.getEnd();
    return {
      index,
      kind: classifyStatement(stmt),
      start,
      end,
      range: toRange(sourceFile, start, end),
      text: source.slice(start, end),
    };
  });

  const diagnostics: ParseDiagnostic[] = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics
    ?.map((d) => {
      const start = d.start ?? 0;
      const end = start + (d.length ?? 0);
      return {
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        range: toRange(sourceFile, start, end),
        start,
        end,
      };
    }) ?? [];

  return { statements, diagnostics, sourceFile };
}

function classifyStatement(stmt: ts.Statement): TopLevelStatementKind {
  if (ts.isExpressionStatement(stmt)) return 'expression';
  if (
    ts.isVariableStatement(stmt) ||
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt) ||
    ts.isImportDeclaration(stmt) ||
    ts.isExportDeclaration(stmt)
  ) {
    return 'declaration';
  }
  if (
    ts.isIfStatement(stmt) ||
    ts.isForStatement(stmt) ||
    ts.isForOfStatement(stmt) ||
    ts.isForInStatement(stmt) ||
    ts.isWhileStatement(stmt) ||
    ts.isDoStatement(stmt) ||
    ts.isTryStatement(stmt) ||
    ts.isSwitchStatement(stmt)
  ) {
    return 'control';
  }
  return 'other';
}

export function toRange(sourceFile: ts.SourceFile, start: number, end: number): SourceRange {
  const s = ts.getLineAndCharacterOfPosition(sourceFile, start);
  const e = ts.getLineAndCharacterOfPosition(sourceFile, end);
  // Monaco is 1-based for both line and column.
  return {
    startLine: s.line + 1,
    startCol: s.character + 1,
    endLine: e.line + 1,
    endCol: e.character + 1,
  };
}

/**
 * Find the top-level statement containing a cursor offset (for
 * "run current statement"). Falls back to the nearest preceding statement.
 */
export function statementAtOffset(
  parsed: ParsedScript,
  offset: number,
): TopLevelStatement | undefined {
  const containing = parsed.statements.find((s) => offset >= s.start && offset <= s.end);
  if (containing) return containing;
  return [...parsed.statements].reverse().find((s) => s.start <= offset);
}

/** True when a position falls inside a comment or string (utility for callers). */
export function isExpressionResultCandidate(stmt: TopLevelStatement): boolean {
  return stmt.kind === 'expression';
}
