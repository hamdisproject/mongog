# SQL beta contract

MongoG SQL is a **MySQL-syntax-to-MongoDB beta**, not a claim of full relational
SQL compatibility. Unsupported constructs fail with a parser range and a
specific hint; they are never approximated by silently dropping clauses.

## Trusted execution flow

The renderer may preview a translation in a Web Worker, but that preview is not
an execution authority. It sends only raw SQL and execution context through the
strict `query.executeSql` API. Main resolves the profile's real `readOnly` flag
and the destructive-confirmation setting, then asks that connection's utility
process to parse and translate the SQL again. The generated JavaScript never
crosses from renderer to main.

`UPDATE` and `DELETE` without `WHERE` require a one-use confirmation token bound
to connection, database and exact SQL source. Tokens expire after 60 seconds.
The confirmation explains that MongoDB multi-document writes are atomic per
document, not one atomic SQL transaction. Automatic transactions are not used.

SQL audit records contain statement kind, namespace and read/write/full-target
classification, not SQL source or literal values. A failed write remains a
write in the audit record.

## Supported beta surface

- `SELECT` from one main collection, plus same-database `INNER` and `LEFT`
  equality joins; `WHERE`; plain projections; plain-field `DISTINCT`; `GROUP
  BY`; `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`; resolvable `HAVING` and `ORDER BY`;
  and positive `LIMIT`/`OFFSET`.
- `INSERT` with an explicit column list and one or more literal `VALUES` rows.
- `UPDATE` of one collection with literal `SET` values and optional `WHERE`;
  every matching document is updated.
- `DELETE` from one collection with optional `WHERE`; every matching document
  is deleted.
- Ungrouped arithmetic and the completion-listed scalar helpers. Grouped
  computed expressions are rejected.

Rejected constructs include CTEs, UNION/set operations, subqueries, `SELECT
INTO`, RIGHT/FULL/CROSS/NATURAL joins, qualified or joined `*`, CASE, aggregate
DISTINCT, `INSERT SELECT`/IGNORE/upsert, and JOIN/ORDER/LIMIT on UPDATE or
DELETE. `LIMIT 0`, cross-database joins, ambiguous aliases and output-name
collisions are errors.

## NULL, numbers and object safety

- A missing BSON field is SQL `NULL`. Explicit projections materialise missing
  fields as `null`.
- `IS NULL` matches null or missing. `IS NOT NULL` requires existence and a
  non-null value.
- Negative/range predicates add existence/non-null guards so MongoDB `$ne` and
  related operators cannot widen the SQL predicate to missing fields.
- `= NULL`, `<> NULL`, NULL in `IN`/`NOT IN`, and NULL `BETWEEN` bounds are
  rejected with an `IS NULL`/`IS NOT NULL` hint.
- `COUNT(field)` counts `false`, `0` and empty strings, excluding only null and
  missing values.
- Integers beyond JavaScript's safe range, non-finite values, and decimal or
  exponent literals with more than 15 significant digits are rejected before
  the parser can round them. Use MQL with BSON `Long` or `Decimal128` for exact
  values outside this beta boundary.
- User-keyed documents and projection/group maps use null-prototype records.
  Duplicate INSERT/UPDATE fields, `__proto__`, and normalised-name collisions
  cannot silently replace data.

SQL source is capped at 256 KiB UTF-8 in the worker, IPC schemas, workspace and
saved-tab payloads. Preview translation is debounced by 200 ms and stale worker
responses are discarded by request id.

## Security boundary

Main always derives `readOnly` from the saved profile for SQL and ordinary
scripts. Query Mode also keeps the early static write scan, while the runtime
wraps real driver objects with recursive read-only proxies. Computed member
access, method aliasing, `use()`, `getSiblingDB()`, dynamic `command()` keys,
`$out`/`$merge`, and `require('mongodb')`-created clients are covered.

This protection reduces accidental and in-app bypass writes. MongoDB server
roles remain the final authorization boundary; use a server account with the
`read` role when writes must be impossible.

