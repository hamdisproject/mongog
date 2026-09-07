/**
 * SQL -> MongoDB translator (PURE: no io, no driver, no IPC).
 *
 * Supported subset (deliberately SELECT-first, like Studio 3T / NoSQLBooster):
 *
 * - SELECT [DISTINCT] cols FROM coll [alias]
 *     [INNER|LEFT JOIN coll2 [alias] ON a.x = b.y ...]
 *     [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT n [OFFSET m]]
 * - INSERT INTO coll (a, b) VALUES (...), (...)
 * - UPDATE coll SET a = v, ... [WHERE ...]
 * - DELETE FROM coll [WHERE ...]
 *
 * Simple SELECTs become `find()`; anything needing DISTINCT, GROUP BY,
 * aggregates, scalar functions, renames or JOINs becomes an aggregation
 * pipeline. Writes map to insertOne/insertMany, updateMany ($set) and
 * deleteMany.
 */
import mysqlParser from 'node-sql-parser/build/mysql.js';
import { MAX_SQL_SOURCE_BYTES, SqlTranslateError, type SqlTranslation } from './types.js';

type AstNode = Record<string, any>;

const { Parser } = mysqlParser;
const parser = new Parser();

const AGG_FUNCS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

/** Aggregate function names supported by the translator (single source of truth for completions). */
export const SQL_AGGREGATE_FUNCTIONS: readonly string[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const SCALAR_FUNCS: Record<string, (arg: string) => Record<string, unknown>> = {
  UPPER: (arg) => ({ $toUpper: arg }),
  LOWER: (arg) => ({ $toLower: arg }),
  LENGTH: (arg) => ({ $strLenCP: arg }),
  TRIM: (arg) => ({ $trim: { input: arg } }),
  LTRIM: (arg) => ({ $ltrim: { input: arg } }),
  RTRIM: (arg) => ({ $rtrim: { input: arg } }),
  YEAR: (arg) => ({ $year: arg }),
  MONTH: (arg) => ({ $month: arg }),
  DAY: (arg) => ({ $dayOfMonth: arg }),
  ABS: (arg) => ({ $abs: arg }),
};

/** Scalar function names supported by the translator (single source of truth for completions). */
export const SQL_SCALAR_FUNCTIONS: readonly string[] = Object.keys(SCALAR_FUNCS);

/** Extra expression helpers supported in computed SELECT expressions. */
export const SQL_EXPRESSION_FUNCTIONS: readonly string[] = ['CONCAT', 'IFNULL', 'COALESCE'];

/** Translate one SQL statement into an equivalent MongoDB operation. */
export function translateSql(input: string): SqlTranslation {
  if (new TextEncoder().encode(input).byteLength > MAX_SQL_SOURCE_BYTES) {
    throw new SqlTranslateError(
      `SQL statements are limited to ${MAX_SQL_SOURCE_BYTES / 1024} KiB.`,
      'Split large writes into smaller statements and run them separately.',
    );
  }
  const sql = input.trim().replace(/;+\s*$/, '');
  if (!sql) {
    throw new SqlTranslateError('Empty SQL statement.', 'Write a SELECT, INSERT, UPDATE or DELETE statement first.');
  }
  validateNumericLiterals(sql);
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: 'MySQL', parseOptions: { includeLocations: true } });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const location = parseErrorRange(caught);
    throw new SqlTranslateError(
      `Could not parse SQL: ${message}`,
      'Only one SELECT, INSERT, UPDATE or DELETE statement is supported. Check commas, quotes and parentheses.',
      location,
    );
  }
  if (Array.isArray(ast)) {
    throw new SqlTranslateError(
      'Multiple SQL statements are not supported.',
      'Run one statement at a time; split scripts on blank lines and execute each separately.',
    );
  }
  if (!ast || typeof ast !== 'object') {
    throw new SqlTranslateError('Could not parse SQL.', 'Write a SELECT, INSERT, UPDATE or DELETE statement.');
  }
  const node = ast as AstNode;
  validateStatementShape(node);
  switch (node.type) {
    case 'select':
      return translateSelect(node);
    case 'insert':
      return translateInsert(node);
    case 'update':
      return translateUpdate(node);
    case 'delete':
      return translateDelete(node);
    default:
      throw new SqlTranslateError(
        `Statement type "${String(node.type)}" is not supported.`,
        'Supported statements: SELECT (incl. JOIN, GROUP BY, DISTINCT), INSERT, UPDATE, DELETE.',
      );
  }
}

function validateStatementShape(node: AstNode): void {
  const reject = (message: string, hint: string): never => {
    throw new SqlTranslateError(message, hint, nodeRange(node));
  };

  if (node.with != null) {
    reject('Common table expressions (WITH) are not supported.', 'Run the inner SELECT separately or use an explicit INNER/LEFT JOIN.');
  }

  if (node.type === 'select') {
    if (node._next != null || node.set_op != null) {
      reject('UNION and other set operations are not supported.', 'Run each SELECT separately.');
    }
    if (node.into?.position != null || node.into?.type != null) {
      reject('SELECT INTO is not supported.', 'Use plain SELECT; SQL writes support INSERT ... VALUES only.');
    }
    if (node.options != null || node.locking_read != null || node.window != null || node.collate != null) {
      reject('This SELECT modifier is not supported.', 'Remove locking, window, collation, or vendor-specific SELECT modifiers.');
    }
    const from = Array.isArray(node.from) ? node.from as AstNode[] : [];
    const joins = from.slice(1);
    for (const join of joins) {
      const kind = String(join.join ?? '').toUpperCase();
      if (kind !== 'INNER JOIN' && kind !== 'LEFT JOIN') {
        reject(`Join type "${kind || 'implicit'}" is not supported.`, 'Use INNER JOIN or LEFT JOIN with one equality condition.');
      }
    }
    const columns = Array.isArray(node.columns) ? node.columns as AstNode[] : [];
    if (joins.length > 0 && columns.some((column) => column.expr?.type === 'column_ref' && column.expr?.column === '*')) {
      reject('SELECT * is not supported with JOIN.', 'List each required base and joined field explicitly.');
    }
    for (const column of columns) {
      const expr = column.expr as AstNode | undefined;
      if (expr?.type === 'case') {
        reject('CASE expressions are not supported.', 'Use a plain field or one of the functions offered by SQL completion.');
      }
      if (expr?.type === 'aggr_func') {
        if (expr.over != null) reject('Windowed aggregates are not supported.', 'Remove the OVER clause.');
        if (expr.args?.distinct != null || expr.args?.orderby != null || expr.args?.separator != null) {
          reject('DISTINCT/ordered aggregate arguments are not supported.', 'Use a plain aggregate such as COUNT(field) or SUM(field).');
        }
      }
    }
    const modifiers = Array.isArray(node.groupby?.modifiers) ? node.groupby.modifiers : [];
    if (modifiers.some((modifier: unknown) => modifier != null)) {
      reject('GROUP BY modifiers such as ROLLUP are not supported.', 'Use a plain GROUP BY field list.');
    }
    return;
  }

  if (node.type === 'insert') {
    const tables = Array.isArray(node.table) ? node.table as AstNode[] : [];
    if (tables.length !== 1 || tables[0]?.as != null) {
      reject('INSERT needs exactly one unaliased target collection.', 'Use INSERT INTO collection (columns) VALUES (...).');
    }
    if (String(node.prefix ?? '').trim().toLowerCase() !== 'into') {
      reject('INSERT modifiers such as IGNORE are not supported.', 'Use INSERT INTO ... (columns) VALUES (...).');
    }
    if (node.partition != null || node.on_duplicate_update != null) {
      reject('INSERT partition/upsert modifiers are not supported.', 'Use a plain INSERT ... VALUES statement.');
    }
    if (node.values?.type !== 'values') {
      reject('INSERT SELECT is not supported.', 'Use an explicit VALUES list.');
    }
    return;
  }

  if (node.type === 'update') {
    const tables = Array.isArray(node.table) ? node.table as AstNode[] : [];
    if (tables.length !== 1 || tables[0]?.join != null || tables[0]?.as != null) {
      reject('UPDATE JOIN and multi-table UPDATE are not supported.', 'Update one collection per statement.');
    }
    if (node.orderby != null || node.limit != null) {
      reject('ORDER BY/LIMIT on UPDATE is not supported.', 'Use a WHERE clause; every matching document is updated.');
    }
    return;
  }

  if (node.type === 'delete') {
    const from = Array.isArray(node.from) ? node.from as AstNode[] : [];
    if (from.length !== 1 || from.some((entry) => entry.join != null || entry.as != null)) {
      reject('DELETE JOIN and multi-table DELETE are not supported.', 'Delete from one collection per statement.');
    }
    if (node.orderby != null || node.limit != null) {
      reject('ORDER BY/LIMIT on DELETE is not supported.', 'Use a WHERE clause; every matching document is deleted.');
    }
  }
}

function parseErrorRange(value: unknown): SqlTranslateError['range'] {
  const location = value && typeof value === 'object'
    ? (value as { location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } }).location
    : undefined;
  const start = location?.start;
  const end = location?.end;
  if (!start?.line || !start.column) return undefined;
  return {
    startLine: start.line,
    startCol: start.column,
    endLine: end?.line ?? start.line,
    endCol: Math.max(end?.column ?? start.column + 1, start.column + 1),
  };
}

function nodeRange(node: AstNode): SqlTranslateError['range'] {
  const start = node.loc?.start as { line?: number; column?: number } | undefined;
  const end = node.loc?.end as { line?: number; column?: number } | undefined;
  if (!start?.line || !start.column) return undefined;
  return {
    startLine: start.line,
    startCol: start.column,
    endLine: end?.line ?? start.line,
    endCol: Math.max(end?.column ?? start.column + 1, start.column + 1),
  };
}

/** Validate raw numeric tokens before the parser can round them into JS numbers. */
function validateNumericLiterals(sql: string): void {
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(sql, index, char);
      continue;
    }
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    const startsNumber = /\d/u.test(char) || (char === '.' && next !== undefined && /\d/u.test(next));
    const previous = index > 0 ? sql[index - 1]! : '';
    if (!startsNumber || /[A-Za-z0-9_$]/u.test(previous)) {
      index += 1;
      continue;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(sql.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    const raw = match[0];
    validateNumericToken(raw, sql, index);
    index += raw.length;
  }
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '\\') {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function validateNumericToken(raw: string, sql: string, offset: number): void {
  const range = rangeAtOffset(sql, offset, raw.length);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new SqlTranslateError('Numeric literal is outside the supported finite range.', 'Use a finite number or MQL BSON numeric constructors.', range);
  }
  const mantissa = raw.split(/[eE]/u, 1)[0]!.replace('.', '');
  const significant = mantissa.replace(/^0+/u, '').length || 1;
  if (!/[.eE]/u.test(raw)) {
    try {
      if (BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new SqlTranslateError(
          `Integer literal "${raw}" exceeds JavaScript's safe integer range.`,
          'Use the MQL editor with Long or Decimal128 for exact BSON numbers.',
          range,
        );
      }
    } catch (caught) {
      if (caught instanceof SqlTranslateError) throw caught;
    }
    if (significant > 15) {
      throw new SqlTranslateError(
        `Numeric literal "${raw}" has more than 15 significant digits.`,
        'Use the MQL editor with Long or Decimal128 for exact BSON numbers.',
        range,
      );
    }
    return;
  }
  if (significant > 15) {
    throw new SqlTranslateError(
      `Numeric literal "${raw}" has more than 15 significant digits.`,
      'Use the MQL editor with Decimal128 for exact decimal values.',
      range,
    );
  }
}

function rangeAtOffset(sql: string, offset: number, length: number): NonNullable<SqlTranslateError['range']> {
  const before = sql.slice(0, offset).split('\n');
  const line = before.length;
  const column = before[before.length - 1]!.length + 1;
  return { startLine: line, startCol: column, endLine: line, endCol: column + Math.max(1, length) };
}

// ── SELECT ────────────────────────────────────────────────────────────────

interface FromEntry {
  db: string | null;
  table: string;
  alias: string | null;
  join?: string;
  on?: AstNode;
}

interface PlainCol {
  /** Unqualified field name. */
  field: string;
  /** Table qualifier as written (`o`, `users`, or null). */
  table: string | null;
  /** Output name (alias or field). */
  output: string;
}

interface GroupKeyRef {
  field: string;
  table: string | null;
}

function translateSelect(node: AstNode): SqlTranslation {
  const fromRaw = node.from as AstNode[] | null;
  if (!fromRaw || fromRaw.length === 0) {
    throw new SqlTranslateError('SELECT without FROM is not supported.', 'Use SELECT ... FROM <collection>.');
  }
  const from: FromEntry[] = fromRaw.map((entry) => ({
    db: entry.db ?? null,
    table: String(entry.table),
    alias: entry.as ?? null,
    ...(entry.join ? { join: String(entry.join) } : {}),
    ...(entry.on ? { on: entry.on as AstNode } : {}),
  }));
  const base = from[0]!;
  const aliasToTable = new Map<string, string>();
  const relationKeys = new Set<string>();
  for (const entry of from) {
    const key = entry.alias ?? entry.table;
    if (relationKeys.has(key)) {
      throw new SqlTranslateError(
        `Duplicate table alias "${key}".`,
        'Give every joined collection a unique alias.',
        nodeRange(entry as AstNode),
      );
    }
    const existingRelation = aliasToTable.get(key);
    if (existingRelation !== undefined && existingRelation !== entry.table) {
      throw new SqlTranslateError(
        `Ambiguous table name or alias "${key}".`,
        'Use unique aliases that do not match another collection name.',
        nodeRange(entry as AstNode),
      );
    }
    relationKeys.add(key);
    aliasToTable.set(key, entry.table);
    aliasToTable.set(entry.table, entry.table);
  }
  const baseKey = base.alias ?? base.table;
  const joins = from.slice(1);
  for (const join of joins) {
    if (!join.join || !/join/i.test(join.join)) {
      throw new SqlTranslateError(
        `Unsupported FROM entry "${join.table}".`,
        'Separate multiple collections with an explicit INNER JOIN or LEFT JOIN with an ON condition.',
      );
    }
    if (!join.on) {
      throw new SqlTranslateError(
        `JOIN on "${join.table}" needs an ON condition.`,
        'Example: ... INNER JOIN users u ON o.userId = u._id',
      );
    }
  }

  const database = base.db ?? undefined;
  for (const entry of joins) {
    if (entry.db != null && entry.db !== database) {
      throw new SqlTranslateError(
        'Querying collections from different databases is not supported.',
        'Qualify the base collection with the same database and keep every JOIN in that database.',
      );
    }
  }

  const rawColumns = node.columns as AstNode[] | string | null | undefined;
  if (rawColumns === '*' || rawColumns == null) {
    throw new SqlTranslateError('Unexpected SELECT shape.', 'Use SELECT * or an explicit column list.');
  }
  const columns: AstNode[] = Array.isArray(rawColumns) ? rawColumns : [];
  const distinct = node.distinct != null && node.distinct !== false;
  const groupByRaw = node.groupby as AstNode | null;
  const groupKeyRefs: GroupKeyRef[] = groupByRaw?.columns
    ? (groupByRaw.columns as AstNode[]).map((col) => columnRef(col, aliasToTable))
    : [];
  const havingRaw = (node.having as AstNode | null) ?? null;
  const orderByRaw = (node.orderby as AstNode[] | null) ?? null;
  const { limit, skip } = parseLimit(node.limit as AstNode | null);

  // Qualifier maps a (field, table) pair to the pipeline field path:
  // base-table fields stay bare, joined-table fields become `<alias>.<field>`.
  const qualify = (field: string, table: string | null): string => {
    if (table == null) return field;
    if (table === baseKey || table === base.table) return field;
    // Joined-table fields live under the $lookup `as` name (alias or table).
    const entry = from.find((candidate) => candidate.alias === table || candidate.table === table);
    return `${entry?.alias ?? entry?.table ?? table}.${field}`;
  };

  // Classify the SELECT list.
  let hasStar = false;
  let hasAgg = false;
  let hasScalarOrExpr = false;
  let hasRename = false;
  const plainCols: PlainCol[] = [];
  const aggs: Array<{ func: string; arg: string | null; output: string }> = [];
  const scalarProjects: Array<{ output: string; expr: Record<string, unknown> }> = [];
  const outputNames = new Set<string>();
  for (const col of columns) {
    const asName = col.as != null ? String(col.as) : null;
    const expr = col.expr as AstNode;
    if (!expr || typeof expr !== 'object') continue;
    if (expr.type === 'column_ref' && expr.column === '*') {
      hasStar = true;
      const qualifier = expr.table != null ? String(expr.table) : null;
      if (qualifier != null) {
        throw new SqlTranslateError('Qualified SELECT * is not supported.', 'Use SELECT * for one collection or list explicit joined fields.');
      }
      if (qualifier != null && !aliasToTable.has(qualifier)) {
        throw new SqlTranslateError(
          `Unknown table qualifier "${qualifier}".`,
          `Available tables: ${from.map((entry) => entry.alias ?? entry.table).join(', ')}.`,
        );
      }
      if (asName) {
        throw new SqlTranslateError('SELECT * cannot be aliased.', 'Alias individual columns instead, e.g. SELECT a AS alpha.');
      }
      continue;
    }
    if (expr.type === 'aggr_func') {
      hasAgg = true;
      const func = String(expr.name).toUpperCase();
      if (!AGG_FUNCS.has(func)) {
        throw new SqlTranslateError(
          `Aggregate "${func}" is not supported.`,
          'Supported aggregates: COUNT, SUM, AVG, MIN, MAX.',
        );
      }
      const arg = aggArg(expr, aliasToTable, baseKey, qualify);
      const output = asName ?? defaultAggName(func, arg);
      ensureUniqueOutput(output, outputNames);
      aggs.push({ func, arg, output });
      continue;
    }
    if (expr.type === 'column_ref') {
      const ref = columnRef(expr, aliasToTable);
      const output = asName ?? shortName(ref.field);
      if (asName && asName !== ref.field) hasRename = true;
      ensureUniqueOutput(output, outputNames);
      plainCols.push({ field: ref.field, table: ref.table, output });
      continue;
    }
    if (expr.type === 'function') {
      hasScalarOrExpr = true;
      const output = asName ?? inferScalarName(expr);
      ensureUniqueOutput(output, outputNames);
      scalarProjects.push({ output, expr: buildScalarExpr(expr, aliasToTable, baseKey, qualify) });
      continue;
    }
    if (expr.type === 'binary_expr' || expr.type === 'unary_expr') {
      hasScalarOrExpr = true;
      if (!asName) {
        throw new SqlTranslateError(
          'Computed SELECT expressions need an alias.',
          'Example: SELECT total * 2 AS double_total FROM orders',
        );
      }
      ensureUniqueOutput(asName, outputNames);
      scalarProjects.push({ output: asName, expr: buildValueExpr(expr, aliasToTable, baseKey, qualify) });
      continue;
    }
    if (isLiteral(expr)) {
      hasScalarOrExpr = true;
      if (!asName) {
        throw new SqlTranslateError(
          'Literal SELECT values need an alias.',
          'Example: SELECT 1 AS one FROM orders',
        );
      }
      ensureUniqueOutput(asName, outputNames);
      scalarProjects.push({ output: asName, expr: { $literal: literalValue(expr) } });
      continue;
    }
    throw new SqlTranslateError(
      `Unsupported SELECT expression of type "${String(expr.type)}".`,
      'Select plain fields, aggregates (COUNT, SUM, AVG, MIN, MAX) or simple functions (UPPER, LOWER, YEAR, ...).',
    );
  }

  if (groupByRaw && groupKeyRefs.length === 0) {
    throw new SqlTranslateError('GROUP BY needs at least one column.', 'Example: SELECT status, COUNT(*) FROM orders GROUP BY status');
  }
  if (hasAgg && groupKeyRefs.length === 0 && plainCols.length > 0 && !distinct) {
    throw new SqlTranslateError(
      'Mixing plain columns with aggregates requires GROUP BY.',
      'Add GROUP BY for the plain columns, e.g. SELECT status, COUNT(*) FROM orders GROUP BY status',
    );
  }
  if (havingRaw && groupKeyRefs.length === 0 && !hasAgg && !distinct) {
    throw new SqlTranslateError('HAVING needs GROUP BY or an aggregate.', 'Filter plain rows with WHERE instead of HAVING.');
  }
  if (distinct && hasAgg) {
    throw new SqlTranslateError('DISTINCT with aggregates is not supported.', 'Use GROUP BY instead of DISTINCT for aggregated queries.');
  }
  if (distinct && (hasStar || hasScalarOrExpr)) {
    throw new SqlTranslateError('DISTINCT supports plain fields only.', 'List one or more plain fields after SELECT DISTINCT.');
  }
  if ((groupKeyRefs.length > 0 || hasAgg) && hasScalarOrExpr) {
    throw new SqlTranslateError(
      'Computed/scalar expressions are not supported in grouped queries.',
      'Select GROUP BY fields and COUNT/SUM/AVG/MIN/MAX aggregates only.',
    );
  }

  const grouped = groupKeyRefs.length > 0 || hasAgg || distinct;
  // An aggregation projection materialises missing BSON fields as SQL NULL.
  // A find() inclusion projection would silently omit them instead.
  const needsAggregate = joins.length > 0 || grouped || hasScalarOrExpr || hasRename ||
    havingRaw != null || !hasStar;

  const warnings: string[] = [];
  const whereRaw = (node.where as AstNode | null) ?? null;

  if (!needsAggregate) {
    const filter = whereRaw ? buildFilter(whereRaw, aliasToTable, baseKey, null) : {};
    let projection: Record<string, unknown> | undefined;
    if (!hasStar) {
      projection = createRecord();
      for (const col of plainCols) projection[col.field] = 1;
      if (!plainCols.some((col) => col.field === '_id')) projection._id = 0;
    }
    const sort = orderByRaw ? buildSort(orderByRaw, aliasToTable, baseKey, null) : undefined;
    const fullCollectionTarget = whereRaw == null;
    if (fullCollectionTarget) warnings.push('No WHERE clause: the query targets the whole collection.');
    const coll = base.table;
    return {
      kind: 'select',
      execution: 'find',
      collection: coll,
      ...(database ? { database } : {}),
      isWrite: false,
      fullCollectionTarget,
      filter,
      ...(projection ? { projection } : {}),
      ...(sort ? { sort } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(skip !== undefined ? { skip } : {}),
      mongosh: renderFind('mongosh', coll, database, filter, projection, sort, limit, skip),
      jsSource: renderFind('js', coll, database, filter, projection, sort, limit, skip),
      warnings,
    };
  }

  // ── Aggregate path ──
  const pipeline: Array<Record<string, unknown>> = [];
  const knownTables = new Set<string>([baseKey, base.table]);
  // $match runs after the lookups: filters may reference joined tables, and
  // correctness beats index use here (same trade-off Studio 3T documents).
  for (const join of joins) {
    const parsed = parseJoinOn(join.on!, aliasToTable, knownTables, base.table, join);
    pipeline.push({
      $lookup: {
        from: join.table,
        localField: parsed.localField,
        foreignField: parsed.foreignField,
        as: parsed.as,
      },
    });
    const kind = join.join!.toUpperCase();
    if (kind.includes('LEFT')) {
      pipeline.push({ $unwind: { path: `$${parsed.as}`, preserveNullAndEmptyArrays: true } });
    } else if (kind.includes('INNER') || kind.includes('JOIN')) {
      pipeline.push({ $unwind: `$${parsed.as}` });
      warnings.push(`INNER JOIN "${join.table}" uses $unwind: one-to-many matches fan out into multiple rows.`);
    } else {
      throw new SqlTranslateError(
        `Join type "${join.join}" is not supported.`,
        'Use INNER JOIN or LEFT JOIN with a single equality condition.',
      );
    }
    knownTables.add(join.alias ?? join.table);
    knownTables.add(join.table);
  }

  if (whereRaw) {
    pipeline.push({ $match: buildFilter(whereRaw, aliasToTable, baseKey, qualify) });
  } else if (joins.length === 0 && !grouped) {
    warnings.push('No WHERE clause: the query targets the whole collection.');
  }

  const qkey = (ref: GroupKeyRef): string => qualify(ref.field, ref.table);
  const groupKeys = groupKeyRefs.map(qkey);
  const aggAliasOf = new Map<string, string>();

  if (distinct && groupKeyRefs.length === 0 && !hasAgg) {
    if (hasStar) {
      throw new SqlTranslateError('SELECT DISTINCT * is not supported.', 'List the columns to deduplicate, e.g. SELECT DISTINCT status FROM people');
    }
    const id = createRecord();
    for (const col of plainCols) id[col.output] = `$${qualify(col.field, col.table)}`;
    pipeline.push({ $group: { _id: id } });
    const project = createRecord();
    project._id = 0;
    for (const col of plainCols) project[col.output] = `$_id.${col.output}`;
    pipeline.push({ $project: project });
  } else if (groupKeyRefs.length > 0 || hasAgg) {
    for (const col of plainCols) {
      const qualified = qualify(col.field, col.table);
      if (!groupKeys.includes(qualified)) {
        throw new SqlTranslateError(
          `Column "${col.field}" must appear in GROUP BY or inside an aggregate.`,
          'Add it to GROUP BY or wrap it, e.g. MIN(...) / MAX(...).',
        );
      }
    }
    const group: Record<string, unknown> = createRecord();
    group._id = buildGroupId(groupKeys);
    for (const agg of aggs) {
      group[agg.output] = buildAccumulator(agg.func, agg.arg);
      aggAliasOf.set(aggKey(agg.func, agg.arg), agg.output);
    }
    pipeline.push({ $group: group });
    const project: Record<string, unknown> = createRecord();
    project._id = 0;
    const groupAliasOf = new Map<string, string>();
    if (groupKeys.length === 1) {
      const key = groupKeys[0]!;
      const output = outputNameForGroupKey(key, plainCols);
      project[output] = '$_id';
      groupAliasOf.set(key, output);
      groupAliasOf.set(shortName(key), output);
    } else {
      for (const key of groupKeys) {
        const output = outputNameForGroupKey(key, plainCols);
        project[output] = `$_id.${sanitizeField(key)}`;
        groupAliasOf.set(key, output);
        groupAliasOf.set(shortName(key), output);
      }
    }
    for (const agg of aggs) project[agg.output] = 1;
    pipeline.push({ $project: project });
    if (havingRaw) {
      pipeline.push({
        $match: buildHaving(havingRaw, aliasToTable, baseKey, qualify, aggAliasOf, groupAliasOf),
      });
    }
  }

  const groupedQuery = groupKeyRefs.length > 0 || hasAgg || distinct;
  const renameEntries = plainCols.filter((col) => col.output !== qualify(col.field, col.table));
  if (scalarProjects.length > 0 || renameEntries.length > 0 || (!hasStar && !groupedQuery)) {
    if (groupedQuery) {
      const addFields = createRecord();
      for (const scalar of scalarProjects) addFields[scalar.output] = scalar.expr;
      if (Object.keys(addFields).length > 0) pipeline.push({ $addFields: addFields });
    } else if (hasStar) {
      // SELECT *, a AS alpha ... keeps the whole document and adds renames.
      const addFields = createRecord();
      for (const col of renameEntries) {
        addFields[col.output] = { $ifNull: [`$${qualify(col.field, col.table)}`, null] };
      }
      for (const scalar of scalarProjects) addFields[scalar.output] = scalar.expr;
      pipeline.push({ $addFields: addFields });
    } else {
      const project = createRecord();
      if (![...plainCols.map((col) => col.output), ...scalarProjects.map((scalar) => scalar.output)].includes('_id')) {
        project._id = 0;
      }
      for (const col of plainCols) {
        const source = `$${qualify(col.field, col.table)}`;
        project[col.output] = { $ifNull: [source, null] };
      }
      for (const scalar of scalarProjects) project[scalar.output] = scalar.expr;
      pipeline.push({ $project: project });
    }
  } else if (!hasStar && !groupedQuery && joins.length > 0) {
    // JOIN without renames: project only the requested (possibly nested) paths.
    const project = createRecord();
    for (const col of plainCols) project[qualify(col.field, col.table)] = 1;
    if (Object.keys(project).length > 0) pipeline.push({ $project: project });
  }

  if (orderByRaw) {
    const sort = buildSort(orderByRaw, aliasToTable, baseKey, qualify);
    const outputMap = new Map<string, string>();
    for (const col of plainCols) outputMap.set(qualify(col.field, col.table), col.output);
    const remapped: Record<string, number> = createRecord();
    for (const [key, dir] of Object.entries(sort)) remapped[outputMap.get(key) ?? key] = dir;
    // ORDER BY runs after the projection stages, so unknown keys sort nothing.
    const knownOutputs = new Set<string>([
      ...plainCols.map((col) => col.output),
      ...scalarProjects.map((scalar) => scalar.output),
      ...aggs.map((agg) => agg.output),
      ...(hasStar ? ['*'] : []),
    ]);
    for (const key of Object.keys(remapped)) {
      if (!knownOutputs.has(key) && !hasStar) {
        throw new SqlTranslateError(
          `ORDER BY "${key}" is not available after projection.`,
          'Order by a selected field, GROUP BY field, or aggregate alias.',
        );
      }
    }
    pipeline.push({ $sort: remapped });
  }
  if (skip !== undefined) pipeline.push({ $skip: skip });
  if (limit !== undefined) pipeline.push({ $limit: limit });

  if (pipeline.length === 0) pipeline.push({ $match: {} });
  const fullCollectionTarget = whereRaw == null;
  const coll = base.table;
  return {
    kind: 'select',
    execution: 'aggregate',
    collection: coll,
    ...(database ? { database } : {}),
    isWrite: false,
    fullCollectionTarget,
    filter: whereRaw ? buildFilter(whereRaw, aliasToTable, baseKey, qualify) : {},
    pipeline,
    ...(limit !== undefined ? { limit } : {}),
    ...(skip !== undefined ? { skip } : {}),
    mongosh: renderAggregate('mongosh', coll, database, pipeline),
    jsSource: renderAggregate('js', coll, database, pipeline),
    warnings,
  };
}

// ── INSERT / UPDATE / DELETE ──────────────────────────────────────────────

function translateInsert(node: AstNode): SqlTranslation {
  const table = firstTable(node.table ?? node.into);
  const columns = node.columns as string[] | null;
  if (!columns || columns.length === 0) {
    throw new SqlTranslateError('INSERT needs an explicit column list.', 'Example: INSERT INTO people (user_id, age) VALUES (\'abc\', 55)');
  }
  const duplicateColumn = columns.find((column, index) => columns.indexOf(column) !== index);
  if (duplicateColumn !== undefined) {
    throw new SqlTranslateError(`Duplicate INSERT column "${duplicateColumn}".`, 'List every target field once.');
  }
  const rows = extractInsertRows(node.values as AstNode | AstNode[] | null);
  if (rows.length === 0) {
    throw new SqlTranslateError('INSERT needs at least one VALUES row.', 'Example: INSERT INTO t (a) VALUES (1), (2)');
  }
  const documents = rows.map((row, index) => {
    if (row.length !== columns.length) {
      throw new SqlTranslateError(
        `VALUES row ${index + 1} has ${row.length} values but ${columns.length} columns.`,
        'Give every row the same number of values as columns.',
      );
    }
    const doc = createRecord();
    columns.forEach((col, colIndex) => {
      doc[String(col)] = literalValue(row[colIndex] as AstNode);
    });
    return doc;
  });
  const execution = documents.length === 1 ? 'insertOne' : 'insertMany';
  const coll = table.name;
  return {
    kind: 'insert',
    execution,
    collection: coll,
    ...(table.db ? { database: table.db } : {}),
    isWrite: true,
    fullCollectionTarget: false,
    filter: {},
    documents,
    mongosh: renderWrite('mongosh', coll, table.db, execution, documents.length === 1 ? documents[0] : documents),
    jsSource: renderWrite('js', coll, table.db, execution, documents.length === 1 ? documents[0] : documents),
    warnings: [],
  };
}

function translateUpdate(node: AstNode): SqlTranslation {
  const table = firstTable(node.table);
  const setList = node.set as AstNode[] | null;
  if (!setList || setList.length === 0) {
    throw new SqlTranslateError('UPDATE needs a SET clause.', 'Example: UPDATE people SET age = 56 WHERE user_id = \'abc\'');
  }
  const update = createRecord();
  for (const item of setList) {
    const column = String(item.column);
    if (!column) throw new SqlTranslateError('UPDATE SET has an empty column.', 'Use SET <field> = <literal value>.');
    if (Object.hasOwn(update, column)) {
      throw new SqlTranslateError(`Duplicate UPDATE field "${column}".`, 'Assign every field once in the SET clause.');
    }
    update[column] = literalValue(item.value as AstNode);
  }
  const whereRaw = (node.where as AstNode | null) ?? null;
  const filter = whereRaw ? buildFilter(whereRaw, new Map([[table.name, table.name]]), table.name, null) : {};
  const warnings: string[] = [];
  if (whereRaw == null) warnings.push('No WHERE clause: UPDATE targets every document in the collection.');
  const coll = table.name;
  return {
    kind: 'update',
    execution: 'updateMany',
    collection: coll,
    ...(table.db ? { database: table.db } : {}),
    isWrite: true,
    fullCollectionTarget: whereRaw == null,
    filter,
    update,
    mongosh: renderUpdate('mongosh', coll, table.db, filter, update),
    jsSource: renderUpdate('js', coll, table.db, filter, update),
    warnings,
  };
}

function translateDelete(node: AstNode): SqlTranslation {
  const table = firstTable(node.table ?? node.from);
  const whereRaw = (node.where as AstNode | null) ?? null;
  const filter = whereRaw ? buildFilter(whereRaw, new Map([[table.name, table.name]]), table.name, null) : {};
  const warnings: string[] = [];
  if (whereRaw == null) warnings.push('No WHERE clause: DELETE removes every document in the collection.');
  const coll = table.name;
  return {
    kind: 'delete',
    execution: 'deleteMany',
    collection: coll,
    ...(table.db ? { database: table.db } : {}),
    isWrite: true,
    fullCollectionTarget: whereRaw == null,
    filter,
    mongosh: renderWrite('mongosh', coll, table.db, 'deleteMany', filter),
    jsSource: renderWrite('js', coll, table.db, 'deleteMany', filter),
    warnings,
  };
}

function firstTable(tableNode: unknown): { name: string; db?: string } {
  const list = Array.isArray(tableNode) ? tableNode : tableNode != null ? [tableNode] : [];
  const first = list[0] as AstNode | undefined;
  if (!first || first.table == null) {
    throw new SqlTranslateError('Could not determine the target collection.', 'Use FROM <collection> / INTO <collection> / UPDATE <collection>.');
  }
  const name = String(first.table);
  if (!name) throw new SqlTranslateError('Empty collection name.', 'Name a collection, e.g. FROM orders.');
  return { name, ...(first.db != null ? { db: String(first.db) } : {}) };
}

function extractInsertRows(valuesNode: AstNode | AstNode[] | null): AstNode[][] {
  if (!valuesNode) return [];
  const holder = (Array.isArray(valuesNode) ? valuesNode[0] : valuesNode) as AstNode;
  const values = holder?.values ?? holder;
  if (!Array.isArray(values)) return [];
  return (values as AstNode[]).map((row) => {
    if (row?.type === 'expr_list' && Array.isArray(row.value)) return row.value as AstNode[];
    return [row];
  });
}

// ── WHERE -> filter ───────────────────────────────────────────────────────

type Qualifier = ((field: string, table: string | null) => string) | null;

function columnRef(expr: AstNode, aliases: Map<string, string>): { field: string; table: string | null } {
  if (expr?.type !== 'column_ref') {
    throw new SqlTranslateError('Expected a column reference.', 'Use plain field names, e.g. WHERE status = \'A\'.');
  }
  const table = expr.table != null ? String(expr.table) : null;
  const field = String(expr.column);
  if (field === '*') {
    throw new SqlTranslateError('Cannot use "*" here.', 'Name a concrete field in WHERE / GROUP BY / ORDER BY.');
  }
  if (table != null && !aliases.has(table)) {
    throw new SqlTranslateError(
      `Unknown table qualifier "${table}".`,
      `Available tables: ${Array.from(new Set(aliases.keys())).join(', ')}.`,
    );
  }
  return { field, table };
}

function qualifyField(
  field: string,
  table: string | null,
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
): string {
  if (table != null && !aliases.has(table)) {
    throw new SqlTranslateError(
      `Unknown table qualifier "${table}".`,
      `Available tables: ${Array.from(new Set(aliases.keys())).join(', ')}.`,
    );
  }
  if (qualify) return qualify(field, table);
  if (table != null && table !== baseKey && aliases.get(table) !== table) {
    throw new SqlTranslateError(
      `Column "${table}.${field}" does not belong to this query.`,
      'JOIN the table first, or drop the table prefix.',
    );
  }
  return field;
}

function buildFilter(expr: AstNode, aliases: Map<string, string>, baseKey: string, qualify: Qualifier): Record<string, unknown> {
  if (!expr || typeof expr !== 'object') {
    throw new SqlTranslateError('Unsupported WHERE condition.', 'Combine comparisons with AND / OR / NOT.');
  }
  // NOT (...) arrives as a function call.
  if (expr.type === 'function' && funcName(expr) === 'NOT') {
    const inner = funcArgs(expr)[0] as AstNode;
    if (!inner) throw new SqlTranslateError('NOT needs a condition.', 'Example: WHERE NOT (status = \'A\')');
    return buildFilter(negatePredicate(inner), aliases, baseKey, qualify);
  }
  if (expr.type !== 'binary_expr') {
    throw new SqlTranslateError(
      `Unsupported WHERE expression of type "${String(expr.type)}".`,
      'Use comparisons (=, <>, >, LIKE, IN, BETWEEN, IS NULL) combined with AND / OR / NOT.',
    );
  }
  const operator = String(expr.operator).toUpperCase();
  if (operator === 'AND') {
    return mergeAnd(
      buildFilter(expr.left as AstNode, aliases, baseKey, qualify),
      buildFilter(expr.right as AstNode, aliases, baseKey, qualify),
    );
  }
  if (operator === 'OR') {
    const left = buildFilter(expr.left as AstNode, aliases, baseKey, qualify);
    const right = buildFilter(expr.right as AstNode, aliases, baseKey, qualify);
    return { $or: [...flattenOr(left), ...flattenOr(right)] };
  }
  if (operator === 'XOR') {
    throw new SqlTranslateError('XOR is not supported.', 'Rewrite with AND / OR / NOT.');
  }

  const left = expr.left as AstNode;
  const right = expr.right as AstNode;

  if (operator === 'IS' || operator === 'IS NOT') {
    if (left?.type !== 'column_ref') {
      throw new SqlTranslateError('IS can only test a column.', 'Example: WHERE deletedAt IS NULL');
    }
    const field = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
    const isNot = operator === 'IS NOT';
    if (right?.type === 'null' || (right?.type === 'bool' && right.value === null)) {
      return isNot ? { [field]: { $exists: true, $ne: null } } : { [field]: null };
    }
    if (right?.type === 'bool') {
      return isNot
        ? andFilters(nonNullGuard(field), { [field]: { $ne: Boolean(right.value) } })
        : { [field]: Boolean(right.value) };
    }
    throw new SqlTranslateError('Unsupported IS comparison.', 'Use IS NULL, IS NOT NULL, IS TRUE or IS FALSE.');
  }

  if (operator === 'LIKE' || operator === 'NOT LIKE') {
    if (left?.type !== 'column_ref') {
      throw new SqlTranslateError('LIKE needs a column on the left.', 'Example: WHERE user_id LIKE \'%bc%\'');
    }
    const field = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
    const regex = likeToRegex(sqlString(right));
    return operator === 'LIKE'
      ? { [field]: { $regex: regex } }
      : andFilters(nonNullGuard(field), { [field]: { $not: { $regex: regex } } });
  }

  if (operator === 'IN' || operator === 'NOT IN') {
    if (left?.type !== 'column_ref') {
      throw new SqlTranslateError('IN needs a column on the left.', 'Example: WHERE status IN (\'A\', \'B\')');
    }
    const field = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
    const values = inList(right);
    if (values.some((value) => value === null)) {
      throw new SqlTranslateError('NULL inside IN/NOT IN is not supported.', 'Use IS NULL/IS NOT NULL as a separate predicate.');
    }
    return operator === 'IN'
      ? { [field]: { $in: values } }
      : andFilters(nonNullGuard(field), { [field]: { $nin: values } });
  }

  if (operator === 'BETWEEN' || operator === 'NOT BETWEEN') {
    if (left?.type !== 'column_ref') {
      throw new SqlTranslateError('BETWEEN needs a column on the left.', 'Example: WHERE age BETWEEN 20 AND 50');
    }
    const field = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
    const [low, high] = betweenBounds(right);
    if (low === null || high === null) {
      throw new SqlTranslateError('BETWEEN bounds cannot be NULL.', 'Use concrete lower and upper values.');
    }
    if (operator === 'BETWEEN') return andFilters(nonNullGuard(field), { [field]: { $gte: low, $lte: high } });
    return andFilters(nonNullGuard(field), { $or: [{ [field]: { $lt: low } }, { [field]: { $gt: high } }] });
  }

  if (['=', '!=', '<>', '>', '>=', '<', '<='].includes(operator)) {
    // Column-to-column comparison -> $expr.
    if (left?.type === 'column_ref' && right?.type === 'column_ref') {
      const lField = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
      const rField = qualifyField(String(right.column), right.table != null ? String(right.table) : null, aliases, baseKey, qualify);
      return andFilters(
        nonNullGuard(lField),
        nonNullGuard(rField),
        { $expr: { [mongoCmp(operator)]: [`$${lField}`, `$${rField}`] } },
      );
    }
    if (left?.type !== 'column_ref') {
      throw new SqlTranslateError(`Operator "${operator}" needs a column on the left.`, 'Example: WHERE age > 25');
    }
    const field = qualifyField(String(left.column), left.table != null ? String(left.table) : null, aliases, baseKey, qualify);
    const value = literalValue(right);
    if (value === null) {
      throw new SqlTranslateError(
        `Comparison "${operator} NULL" is not supported; use IS NULL or IS NOT NULL.`,
        'Use IS NULL or IS NOT NULL; SQL comparisons with NULL are UNKNOWN.',
      );
    }
    switch (operator) {
      case '=':
        return { [field]: value };
      case '!=':
      case '<>':
        return andFilters(nonNullGuard(field), { [field]: { $ne: value } });
      case '>':
        return andFilters(nonNullGuard(field), { [field]: { $gt: value } });
      case '>=':
        return andFilters(nonNullGuard(field), { [field]: { $gte: value } });
      case '<':
        return andFilters(nonNullGuard(field), { [field]: { $lt: value } });
      case '<=':
        return andFilters(nonNullGuard(field), { [field]: { $lte: value } });
      default:
        break;
    }
  }

  throw new SqlTranslateError(
    `Operator "${String(expr.operator)}" is not supported.`,
    'Supported: =, <>, !=, >, >=, <, <=, AND, OR, NOT, LIKE, IN, BETWEEN, IS NULL.',
  );
}

function mergeAnd(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!(key in out)) {
      out[key] = value;
      continue;
    }
    const existing = out[key];
    if (!key.startsWith('$') && isPlainObject(existing) && isPlainObject(value)) {
      // Range merge: age > 25 AND age <= 50 -> { age: { $gt: 25, $lte: 50 } }.
      const existingKeys = new Set(Object.keys(existing));
      const compatible = Object.entries(value).every(([operator, operand]) => (
        !existingKeys.has(operator) || Object.is(existing[operator], operand)
      ));
      if (compatible) {
        out[key] = { ...existing, ...value };
        continue;
      }
    }
    return { $and: [left, right] };
  }
  return out;
}

function nonNullGuard(field: string): Record<string, unknown> {
  return { [field]: { $exists: true, $ne: null } };
}

function andFilters(...filters: Array<Record<string, unknown>>): Record<string, unknown> {
  return filters.reduce((combined, filter) => mergeAnd(combined, filter));
}

function negatePredicate(expr: AstNode): AstNode {
  if (expr?.type === 'function' && funcName(expr) === 'NOT') {
    const nested = funcArgs(expr)[0] as AstNode | undefined;
    if (!nested) throw new SqlTranslateError('NOT needs a condition.', 'Example: WHERE NOT (status = \'A\')');
    return nested;
  }
  if (expr?.type !== 'binary_expr') {
    throw new SqlTranslateError('This NOT expression is not supported.', 'Apply NOT to comparisons joined by AND/OR.');
  }
  const operator = String(expr.operator).toUpperCase();
  if (operator === 'AND' || operator === 'OR') {
    return {
      ...expr,
      operator: operator === 'AND' ? 'OR' : 'AND',
      left: negatePredicate(expr.left as AstNode),
      right: negatePredicate(expr.right as AstNode),
    };
  }
  const inverse: Record<string, string> = {
    '=': '!=',
    '!=': '=',
    '<>': '=',
    '>': '<=',
    '>=': '<',
    '<': '>=',
    '<=': '>',
    LIKE: 'NOT LIKE',
    'NOT LIKE': 'LIKE',
    IN: 'NOT IN',
    'NOT IN': 'IN',
    BETWEEN: 'NOT BETWEEN',
    'NOT BETWEEN': 'BETWEEN',
    IS: 'IS NOT',
    'IS NOT': 'IS',
  };
  const replacement = inverse[operator];
  if (!replacement) throw new SqlTranslateError(`NOT ${operator} is not supported.`, 'Rewrite the condition with supported comparisons.');
  return { ...expr, operator: replacement };
}

function flattenOr(filter: Record<string, unknown>): unknown[] {
  if (filter && typeof filter === 'object' && '$or' in filter && Object.keys(filter).length === 1) {
    const inner = (filter as Record<string, unknown>).$or;
    if (Array.isArray(inner)) return inner;
  }
  return [filter];
}

function mongoCmp(operator: string): string {
  switch (operator) {
    case '=':
      return '$eq';
    case '!=':
    case '<>':
      return '$ne';
    case '>':
      return '$gt';
    case '>=':
      return '$gte';
    case '<':
      return '$lt';
    case '<=':
      return '$lte';
    default:
      return '$eq';
  }
}

function sqlString(node: AstNode): string {
  if (
    node?.type === 'single_quote_string' ||
    node?.type === 'double_quote_string' ||
    node?.type === 'string'
  ) {
    return String(node.value);
  }
  throw new SqlTranslateError('LIKE needs a string pattern.', 'Example: WHERE name LIKE \'%son%\'');
}

function likeToRegex(pattern: string): string {
  // SQL % -> .*, _ -> ., everything else escaped. Anchored full match.
  let out = '';
  for (const char of pattern) {
    if (char === '%') out += '.*';
    else if (char === '_') out += '.';
    else out += escapeRegExp(char);
  }
  return `^${out}$`;
}

function escapeRegExp(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

function inList(node: AstNode): unknown[] {
  if (node?.type === 'expr_list' && Array.isArray(node.value)) {
    const items = node.value as AstNode[];
    if (items.length === 1 && items[0]?.ast != null) {
      throw new SqlTranslateError(
        'Subqueries in IN are not supported yet.',
        'Use an INNER JOIN instead, or run the inner query first and paste its values.',
      );
    }
    return items.map((item) => literalValue(item));
  }
  if (node?.type === 'select' || node?.ast != null) {
    throw new SqlTranslateError(
      'Subqueries in IN are not supported yet.',
      'Use an INNER JOIN instead, or run the inner query first and paste its values.',
    );
  }
  throw new SqlTranslateError('IN needs a value list.', 'Example: WHERE status IN (\'A\', \'B\')');
}

function betweenBounds(node: AstNode): [unknown, unknown] {
  if (node?.type === 'expr_list' && Array.isArray(node.value) && (node.value as unknown[]).length === 2) {
    const [low, high] = node.value as AstNode[];
    return [literalValue(low!), literalValue(high!)];
  }
  throw new SqlTranslateError('BETWEEN needs two bounds.', 'Example: WHERE age BETWEEN 20 AND 50');
}

// ── Literals / values ─────────────────────────────────────────────────────

function isLiteral(node: AstNode): boolean {
  return (
    node?.type === 'number' ||
    node?.type === 'string' ||
    node?.type === 'single_quote_string' ||
    node?.type === 'double_quote_string' ||
    node?.type === 'bool' ||
    node?.type === 'null'
  );
}

function literalValue(node: AstNode): unknown {
  if (!node || typeof node !== 'object') {
    throw new SqlTranslateError('Unsupported value.', 'Use string, number, TRUE/FALSE or NULL literals.');
  }
  switch (node.type) {
    case 'number':
      return Number(node.value);
    case 'single_quote_string':
    case 'double_quote_string':
    case 'string':
      return String(node.value);
    case 'bool':
      return Boolean(node.value);
    case 'null':
      return null;
    default:
      throw new SqlTranslateError(
        `Unsupported value of type "${String(node.type)}".`,
        'Use string, number, TRUE/FALSE or NULL literals.',
      );
  }
}

// ── Aggregates / expressions / sort / limit ───────────────────────────────

function aggArg(
  expr: AstNode,
  aliases?: Map<string, string>,
  baseKey?: string,
  qualify?: Qualifier,
): string | null {
  const args = expr.args as AstNode | null;
  const inner = args?.expr as AstNode | undefined;
  if (!inner || inner.type === 'star') return null;
  if (inner.type === 'column_ref') {
    const field = String(inner.column);
    const table = inner.table != null ? String(inner.table) : null;
    return aliases && baseKey
      ? qualifyField(field, table, aliases, baseKey, qualify ?? null)
      : field;
  }
  throw new SqlTranslateError(
    'Aggregates take a plain column or *.',
    'Example: COUNT(*), SUM(total), AVG(total).',
  );
}

function defaultAggName(func: string, arg: string | null): string {
  if (arg == null) return func.toLowerCase();
  return `${func.toLowerCase()}_${sanitizeField(arg)}`;
}

function aggKey(func: string, arg: string | null): string {
  return `${func}(${arg ?? '*'})`;
}

function buildAccumulator(func: string, arg: string | null): Record<string, unknown> {
  switch (func) {
    case 'COUNT':
      if (arg == null) return { $sum: 1 };
      return {
        $sum: {
          $cond: [
            { $and: [{ $ne: [{ $type: `$${arg}` }, 'missing'] }, { $ne: [`$${arg}`, null] }] },
            1,
            0,
          ],
        },
      };
    case 'SUM':
      return { $sum: `$${arg}` };
    case 'AVG':
      return { $avg: `$${arg}` };
    case 'MIN':
      return { $min: `$${arg}` };
    case 'MAX':
      return { $max: `$${arg}` };
    default:
      throw new SqlTranslateError(`Aggregate "${func}" is not supported.`, 'Supported aggregates: COUNT, SUM, AVG, MIN, MAX.');
  }
}

function buildGroupId(keys: string[]): unknown {
  if (keys.length === 0) return null;
  if (keys.length === 1) return `$${keys[0]}`;
  const id = createRecord();
  for (const key of keys) {
    const safe = sanitizeField(key);
    if (Object.hasOwn(id, safe)) {
      throw new SqlTranslateError(
        `GROUP BY fields collide after normalization at "${safe}".`,
        'Alias or rename the conflicting fields so each group key is unique.',
      );
    }
    id[safe] = `$${key}`;
  }
  return id;
}

function outputNameForGroupKey(key: string, plainCols: PlainCol[]): string {
  return plainCols.find((col) => key === col.field || key.endsWith(`.${col.field}`))?.output ?? sanitizeField(key);
}

function sanitizeField(field: string): string {
  return field.replace(/[^A-Za-z0-9_]/g, '_');
}

function shortName(field: string): string {
  return field.includes('.') ? (field.split('.').pop() ?? field) : field;
}

function ensureUniqueOutput(output: string, seen: Set<string>): void {
  if (seen.has(output)) {
    throw new SqlTranslateError(
      `Duplicate output name "${output}".`,
      'Give each selected expression a unique alias with AS.',
    );
  }
  seen.add(output);
}

function inferScalarName(expr: AstNode): string {
  const name = funcName(expr).toLowerCase();
  const args = funcArgs(expr);
  const first = args[0] as AstNode | undefined;
  if (first?.type === 'column_ref') return `${name}_${sanitizeField(String(first.column))}`;
  return name;
}

function buildScalarExpr(
  expr: AstNode,
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
): Record<string, unknown> {
  const name = funcName(expr).toUpperCase();
  const builder = SCALAR_FUNCS[name];
  if (!builder) {
    return buildValueExpr(expr, aliases, baseKey, qualify);
  }
  const args = funcArgs(expr);
  if (args.length !== 1 || (args[0] as AstNode)?.type !== 'column_ref') {
    throw new SqlTranslateError(
      `Function "${name}" takes a single column.`,
      `Example: SELECT ${name}(name) FROM ...`,
    );
  }
  const col = args[0] as AstNode;
  const table = col.table != null ? String(col.table) : null;
  if (table != null && !aliases.has(table)) {
    throw new SqlTranslateError(`Unknown table qualifier "${table}".`, 'Check the FROM and JOIN aliases.');
  }
  const path = `$${qualifyField(String(col.column), table, aliases, baseKey, qualify)}`;
  return builder(path);
}

function buildValueExpr(
  expr: AstNode,
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
): Record<string, unknown> {
  if (!expr || typeof expr !== 'object') {
    throw new SqlTranslateError('Unsupported expression.', 'Use fields, literals and simple arithmetic.');
  }
  if (expr.type === 'column_ref') {
    const table = expr.table != null ? String(expr.table) : null;
    return `$${qualifyField(String(expr.column), table, aliases, baseKey, qualify)}` as unknown as Record<string, unknown>;
  }
  if (isLiteral(expr)) return { $literal: literalValue(expr) };
  if (expr.type === 'function') {
    const upper = funcName(expr).toUpperCase();
    if (upper === 'IFNULL' || upper === 'COALESCE') {
      const args = funcArgs(expr);
      if (upper === 'IFNULL' && args.length !== 2) {
        throw new SqlTranslateError('IFNULL needs exactly two arguments.', "Example: IFNULL(field, 'fallback')");
      }
      if (upper === 'COALESCE' && args.length < 2) {
        throw new SqlTranslateError('COALESCE needs at least two arguments.', "Example: COALESCE(field, fallback, 'default')");
      }
      return { $ifNull: args.map((arg) => buildValueExpr(arg as AstNode, aliases, baseKey, qualify)) };
    }
    if (upper === 'CONCAT') {
      const args = funcArgs(expr);
      if (args.length < 2) throw new SqlTranslateError('CONCAT needs at least two arguments.', "Example: CONCAT(firstName, ' ', lastName)");
      return { $concat: args.map((arg) => buildValueExpr(arg as AstNode, aliases, baseKey, qualify)) };
    }
    if (SCALAR_FUNCS[upper]) {
      return buildScalarExpr(expr, aliases, baseKey, qualify);
    }
  }
  if (expr.type === 'binary_expr') {
    const opMap: Record<string, string> = { '+': '$add', '-': '$subtract', '*': '$multiply', '/': '$divide', '%': '$mod' };
    const mongoOp = opMap[String(expr.operator)];
    if (mongoOp) {
      return {
        [mongoOp]: [
          buildValueExpr(expr.left as AstNode, aliases, baseKey, qualify),
          buildValueExpr(expr.right as AstNode, aliases, baseKey, qualify),
        ],
      };
    }
  }
  throw new SqlTranslateError(
    'Unsupported computed expression.',
    'Supported: + - * / %, CONCAT(...), IFNULL(...).',
  );
}

function buildHaving(
  expr: AstNode,
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
  aggAliases: Map<string, string>,
  groupAliases: Map<string, string>,
): Record<string, unknown> {
  const rewritten = rewriteHavingRefs(expr, aliases, baseKey, qualify, aggAliases, groupAliases);
  return buildFilter(rewritten, outputAliases(aggAliases, groupAliases), baseKey, null);
}

function rewriteHavingRefs(
  expr: AstNode,
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
  aggAliases: Map<string, string>,
  groupAliases: Map<string, string>,
): AstNode {
  if (!expr || typeof expr !== 'object') return expr;
  if (expr.type === 'aggr_func') {
    const func = String(expr.name).toUpperCase();
    const arg = aggArg(expr, aliases, baseKey, qualify);
    const output = aggAliases.get(aggKey(func, arg));
    if (!output) {
      throw new SqlTranslateError(
        'HAVING aggregates must also appear in SELECT.',
        'Add the aggregate to the SELECT list with an alias.',
      );
    }
    return { type: 'column_ref', table: null, column: output };
  }
  if (expr.type === 'column_ref') {
    const column = String(expr.column);
    if ([...aggAliases.values()].includes(column)) return { ...expr, table: null };
    const table = expr.table != null ? String(expr.table) : null;
    const qualified = table ? qualifyField(column, table, aliases, baseKey, qualify) : column;
    const output = groupAliases.get(qualified) ?? groupAliases.get(column);
    if (!output) {
      throw new SqlTranslateError(
        `HAVING cannot use "${column}".`,
        'HAVING supports GROUP BY keys and SELECT aggregates only.',
      );
    }
    return { type: 'column_ref', table: null, column: output };
  }
  if (expr.type === 'binary_expr') {
    return {
      ...expr,
      left: rewriteHavingRefs(expr.left as AstNode, aliases, baseKey, qualify, aggAliases, groupAliases),
      right: rewriteHavingRefs(expr.right as AstNode, aliases, baseKey, qualify, aggAliases, groupAliases),
    };
  }
  if (expr.type === 'function' && funcName(expr) === 'NOT') {
    const args = funcArgs(expr).map((arg) => (
      rewriteHavingRefs(arg as AstNode, aliases, baseKey, qualify, aggAliases, groupAliases)
    ));
    if (Array.isArray(expr.args)) return { ...expr, args };
    return { ...expr, args: { ...(expr.args as object), value: args } };
  }
  return expr;
}

function outputAliases(aggAliases: Map<string, string>, groupAliases: Map<string, string>): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const output of [...aggAliases.values(), ...groupAliases.values()]) aliases.set(output, output);
  return aliases;
}

function buildSort(
  orderBy: AstNode[],
  aliases: Map<string, string>,
  baseKey: string,
  qualify: Qualifier,
): Record<string, number> {
  const sort: Record<string, number> = createRecord();
  for (const item of orderBy) {
    const expr = item.expr as AstNode;
    if (expr?.type !== 'column_ref') {
      throw new SqlTranslateError('ORDER BY supports plain columns only.', 'Example: ORDER BY createdAt DESC');
    }
    const table = expr.table != null ? String(expr.table) : null;
    const field = qualify
      ? qualify(String(expr.column), table)
      : qualifyField(String(expr.column), table, aliases, baseKey, null);
    const direction = String(item.type ?? 'ASC').toUpperCase();
    if (direction !== 'ASC' && direction !== 'DESC') {
      throw new SqlTranslateError(`ORDER BY direction "${direction}" is not supported.`, 'Use ASC or DESC.');
    }
    const dir = direction === 'DESC' ? -1 : 1;
    sort[field] = dir;
  }
  if (Object.keys(sort).length === 0) {
    throw new SqlTranslateError('ORDER BY needs at least one column.', 'Example: ORDER BY createdAt DESC');
  }
  return sort;
}

function parseLimit(limit: AstNode | null): { limit?: number; skip?: number } {
  if (limit == null) return {};
  const values = (limit.value as AstNode[] | undefined) ?? [];
  const numbers = values.map((value) => {
    if (value?.type !== 'number' || !Number.isInteger(Number(value.value)) || Number(value.value) < 0) {
      throw new SqlTranslateError('LIMIT needs non-negative integers.', 'Example: LIMIT 20 or LIMIT 20 OFFSET 10');
    }
    return Number(value.value);
  });
  const count = numbers.length === 1
    ? numbers[0]
    : String(limit.seperator ?? '') === ','
      ? numbers[1]
      : numbers[0];
  if (count === 0) {
    throw new SqlTranslateError(
      'LIMIT 0 is not supported in SQL beta.',
      'MongoDB interprets cursor.limit(0) as no limit; use a positive LIMIT.',
      nodeRange(limit),
    );
  }
  const separator = String(limit.seperator ?? '');
  if (numbers.length === 1) return { limit: numbers[0] };
  if (numbers.length === 2) {
    // MySQL: LIMIT offset, count vs LIMIT count OFFSET skip.
    if (separator === ',') return { skip: numbers[0], limit: numbers[1] };
    return { limit: numbers[0], skip: numbers[1] };
  }
  throw new SqlTranslateError('Unsupported LIMIT clause.', 'Use LIMIT <count> with an optional OFFSET <skip>.');
}

// ── JOIN ──────────────────────────────────────────────────────────────────

function parseJoinOn(
  on: AstNode,
  aliases: Map<string, string>,
  knownTables: Set<string>,
  baseTable: string,
  join: FromEntry,
): { localField: string; foreignField: string; as: string } {
  if (on?.type !== 'binary_expr' || String(on.operator) !== '=') {
    throw new SqlTranslateError(
      `JOIN on "${join.table}" needs a single equality.`,
      'Example: ... JOIN users u ON o.userId = u._id',
    );
  }
  const left = on.left as AstNode;
  const right = on.right as AstNode;
  if (left?.type !== 'column_ref' || right?.type !== 'column_ref') {
    throw new SqlTranslateError('JOIN ... ON compares two columns.', 'Example: ON o.userId = u._id');
  }
  const newKeys = new Set([join.alias ?? join.table, join.table]);
  const leftTable = left.table != null ? String(left.table) : null;
  const rightTable = right.table != null ? String(right.table) : null;
  const leftIsNew = leftTable != null && newKeys.has(leftTable);
  const rightIsNew = rightTable != null && newKeys.has(rightTable);
  if (leftIsNew === rightIsNew) {
    throw new SqlTranslateError(
      'JOIN ... ON must link the new table to an earlier one.',
      'Example: ... JOIN users u ON o.userId = u._id',
    );
  }
  const knownSide = leftIsNew ? right : left;
  const newSide = leftIsNew ? left : right;
  const knownTable = knownSide.table != null ? String(knownSide.table) : null;
  if (knownTable != null && !knownTables.has(knownTable) && !aliases.has(knownTable)) {
    throw new SqlTranslateError(
      `Unknown table "${knownTable}" in JOIN ... ON.`,
      'Each JOIN may only reference tables to its left.',
    );
  }
  void aliases;
  const firstKnown = [...knownTables][0];
  const isBaseRef = knownTable === null || knownTable === firstKnown || knownTable === baseTable;
  const knownField = isBaseRef ? String(knownSide.column) : `${knownTable}.${String(knownSide.column)}`;
  return {
    localField: knownField,
    foreignField: String(newSide.column),
    as: join.alias ?? join.table,
  };
}

// ── Function helpers ──────────────────────────────────────────────────────

function funcName(expr: AstNode): string {
  const name = expr?.name as unknown;
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const parts = (name as Record<string, unknown>).name;
    if (Array.isArray(parts)) {
      return parts.map((part) => String((part as Record<string, unknown>).value ?? part)).join('.');
    }
  }
  return '';
}

function funcArgs(expr: AstNode): AstNode[] {
  const args = expr?.args as unknown;
  if (Array.isArray(args)) return args as AstNode[];
  if (args && typeof args === 'object') {
    const value = (args as Record<string, unknown>).value;
    if (Array.isArray(value)) return value as AstNode[];
  }
  return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRecord<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

// ── Codegen ───────────────────────────────────────────────────────────────

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderValue(value: unknown): string {
  if (!containsPrototypeKey(value)) return pretty(value);
  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

function containsPrototypeKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsPrototypeKey(entry));
  if (Object.hasOwn(value, '__proto__')) return true;
  return Object.values(value).some((entry) => containsPrototypeKey(entry));
}

function collAccess(mode: 'mongosh' | 'js', collection: string, database?: string): string {
  const name = JSON.stringify(collection);
  if (database) {
    return mode === 'mongosh'
      ? `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${name})`
      : `db.getSiblingDB(${JSON.stringify(database)}).collection(${name})`;
  }
  return mode === 'mongosh' ? `db.getCollection(${name})` : `db.collection(${name})`;
}

function renderFind(
  mode: 'mongosh' | 'js',
  collection: string,
  database: string | undefined,
  filter: Record<string, unknown>,
  projection: Record<string, unknown> | undefined,
  sort: Record<string, number> | undefined,
  limit: number | undefined,
  skip: number | undefined,
): string {
  let out = `${collAccess(mode, collection, database)}.find(${renderValue(filter)}`;
  out += projection ? `, ${renderValue({ projection })}` : '';
  out += ')';
  if (sort) out += `.sort(${renderValue(sort)})`;
  if (skip !== undefined) out += `.skip(${skip})`;
  if (limit !== undefined) out += `.limit(${limit})`;
  return `${out};`;
}

function renderAggregate(
  mode: 'mongosh' | 'js',
  collection: string,
  database: string | undefined,
  pipeline: Array<Record<string, unknown>>,
): string {
  return `${collAccess(mode, collection, database)}.aggregate(${renderValue(pipeline)});`;
}

function renderWrite(
  mode: 'mongosh' | 'js',
  collection: string,
  database: string | undefined,
  method: 'insertOne' | 'insertMany' | 'deleteMany',
  payload: unknown,
): string {
  return `${collAccess(mode, collection, database)}.${method}(${renderValue(payload)});`;
}

function renderUpdate(
  mode: 'mongosh' | 'js',
  collection: string,
  database: string | undefined,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
): string {
  return `${collAccess(mode, collection, database)}.updateMany(${renderValue(filter)}, ${renderValue({ $set: update })});`;
}
