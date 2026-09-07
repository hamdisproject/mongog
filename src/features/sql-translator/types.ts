/**
 * SQL -> MongoDB translator types (PURE: no io, no driver, no IPC).
 *
 * Mirrors how Studio 3T ("SQL Query" + "Query Code") and NoSQLBooster
 * (`mb.runSQLQuery`) behave: SQL is validated and translated into an
 * equivalent MQL read/write, which the user can preview before running.
 * The translated output always executes through MongoG's existing script
 * engine, so cursors, paging, read-only policy and redaction keep working.
 */

export {
  MAX_SQL_SOURCE_BYTES,
  type SqlExecutionKind,
  type SqlExecuteRequest,
  type SqlExecuteResult,
  type SqlPreview,
  type SqlStatementKind,
  type SqlTranslation,
} from '../../shared/domain/sql.js';

/** Thrown for unsupported SQL or invalid input; `hint` is user-facing. */
export class SqlTranslateError extends Error {
  readonly hint: string;
  readonly range?: { startLine: number; startCol: number; endLine: number; endCol: number };

  constructor(
    message: string,
    hint: string,
    range?: { startLine: number; startCol: number; endLine: number; endCol: number },
  ) {
    super(message);
    this.name = 'SqlTranslateError';
    this.hint = hint;
    this.range = range;
  }
}
