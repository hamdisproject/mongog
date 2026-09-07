/**
 * Execution policy scans (plan §5 Query Mode, §16 read-only).
 *
 * Query Mode scan: hard restrictions, enforced by refusing to run.
 * Read-only scan: early source-ranged detection of obvious writes. The runtime
 * driver-object proxy is the in-app enforcement for computed access and
 * aliasing; server-side roles remain the final authorization boundary.
 */
import ts from 'typescript';
import type { SourceRange } from '../../shared/errors/index.js';
import { toRange } from '../../features/script-analysis/parse.js';
import { READ_ONLY_WRITE_COMMAND_KEYS, READ_ONLY_WRITE_METHODS } from './read-only-guard.js';

export interface PolicyViolation {
  message: string;
  range: SourceRange;
}

const QUERY_MODE_DENIED_IDENTIFIERS = new Set([
  'process',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'global',
  'Buffer',
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'import',
]);

export function scanQueryModeViolations(sourceFile: ts.SourceFile): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const report = (node: ts.Node, message: string): void => {
    violations.push({
      message,
      range: toRange(sourceFile, node.getStart(sourceFile), node.getEnd()),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      report(node, 'Query Mode does not allow import declarations.');
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'require') {
        report(node, 'Query Mode does not allow require(); use the provided driver context.');
      }
      // Dynamic import()
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        report(node, 'Query Mode does not allow dynamic import().');
      }
    } else if (ts.isIdentifier(node)) {
      if (QUERY_MODE_DENIED_IDENTIFIERS.has(node.text) && isRootReference(node)) {
        report(node, `Query Mode does not provide "${node.text}".`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** Identifier is a root reference (not a property name / assignment key). */
function isRootReference(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return false;
  if (ts.isPropertySignature(p) && p.name === node) return false;
  if (ts.isMethodDeclaration(p) && p.name === node) return false;
  return true;
}

export function scanWriteOperations(sourceFile: ts.SourceFile): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const report = (node: ts.Node, message: string): void => {
    violations.push({
      message,
      range: toRange(sourceFile, node.getStart(sourceFile), node.getEnd()),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && READ_ONLY_WRITE_METHODS.has(node.name.text)) {
      report(node.name, `Read-only connection: write operation "${node.name.text}()" is blocked.`);
    }
    // db.collection("x").aggregate([{ $out: ... }]) / $merge
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'aggregate') {
        for (const arg of node.arguments) {
          if (containsPipelineWriteStage(arg)) {
            report(node, 'Read-only connection: aggregation with $out/$merge is blocked.');
            break;
          }
        }
      }
      // db.command({ insert: ... }) style writes
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'command') {
        const first = node.arguments[0];
        if (first && ts.isObjectLiteralExpression(first)) {
          for (const prop of first.properties) {
            if (ts.isPropertyAssignment(prop)) {
              const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : undefined;
              if (key && READ_ONLY_WRITE_COMMAND_KEYS.has(key)) {
                report(prop.name, `Read-only connection: command "${key}" is blocked.`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function containsPipelineWriteStage(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const name = n.name;
      if (
        (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
        (name.text === '$out' || name.text === '$merge')
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}
