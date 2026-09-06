/**
 * SQL -> MongoDB translator types (PURE: no io, no driver, no IPC).
 *
 * Mirrors how Studio 3T ("SQL Query" + "Query Code") and NoSQLBooster
 * (`mb.runSQLQuery`) behave: SQL is validated and translated into an
 * equivalent MQL read/write, which the user can preview before running.
 * The translated output always executes through MongoG's existing script
 * engine, so cursors, paging, read-only policy and redaction keep working.
 */

export type SqlStatementKind = 'select' | 'insert' | 'update' | 'delete';

export type SqlExecutionKind =
  | 'find'
  | 'aggregate'
  | 'insertOne'
  | 'insertMany'
  | 'updateMany'
  | 'deleteMany';

export interface SqlTranslation {
  kind: SqlStatementKind;
  execution: SqlExecutionKind;
  /** Target collection (unquoted table name). */
  collection: string;
  /** Present when the SQL names a database explicitly (`FROM db.coll`). */
  database?: string;
  isWrite: boolean;
  /** Read without WHERE, or DELETE/UPDATE without WHERE. */
  fullCollectionTarget: boolean;
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, number>;
  limit?: number;
  skip?: number;
  pipeline?: Array<Record<string, unknown>>;
  /** INSERT documents. */
  documents?: Array<Record<string, unknown>>;
  /** UPDATE $set payload. */
  update?: Record<string, unknown>;
  /** Copy-paste friendly mongosh snippet (`db.getCollection(...)`). */
  mongosh: string;
  /** Executable through the MongoG script engine (`db.collection(...)`). */
  jsSource: string;
  warnings: string[];
}

/** Thrown for unsupported SQL or invalid input; `hint` is user-facing. */
export class SqlTranslateError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'SqlTranslateError';
    this.hint = hint;
  }
}
