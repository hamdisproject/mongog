# Phase 4 — Schema-aware completions

Status: **COMPLETE and verified** (2026-08-07)

Phase 4 combines the installed MongoDB driver's real TypeScript declarations
with bounded live metadata and AST-based query context. Driver APIs continue to
come from `mongodb.d.ts`; MongoG does not maintain a duplicate method list.

## Delivered

- Monaco loads the installed `mongodb` and `bson` declarations from the
  build-time manifest. Collection, cursor, client, BSON, session, transaction,
  and option completions therefore track the installed package version.
- The semantic provider uses the TypeScript AST rather than regular expressions
  to classify collection/database strings, filter/update/document keys,
  projection/sort documents, query/update operators, pipeline stages, and
  aggregation field references.
- Collection context resolves through direct chains, local collection aliases,
  cursor aliases, and chained cursor methods.
- Live database and collection names are suggested inside `client.db(...)`,
  `use(...)`, and `db.collection(...)` string positions.
- Bounded runtime sampling infers dotted field paths, observed BSON types,
  presence ratios, examples, and array element types. Empty collections produce
  a valid cacheable inferred snapshot.
- Root and nested document positions receive appropriate schema fields. Nested
  object literals receive relative immediate fields; dotted root paths remain
  available for MongoDB query syntax.
- `$match`, `$project`, `$sort`, `$set`, and `$addFields` pipeline documents use
  sampled fields. Aggregation strings such as `"$field"` receive field-reference
  completions.
- Query-root, field-level, update, and aggregation-stage symbols are separated
  by AST context. These language symbols supplement rather than replace the
  installed driver's TypeScript completions.
- Schema snapshots carry connection/database/collection identity, sample time,
  TTL, and the explicit `inferred: true` label.
- The renderer cache deduplicates concurrent sampling, honours the snapshot TTL,
  avoids stale in-flight repopulation, and invalidates on document mutation or
  connection loss.
- Sampling failures are advisory: authorization errors, timeouts, and disconnects
  do not interfere with the installed driver/type completions.

## Security and architecture checks

- Sampling runs only in the per-connection utility process with the official
  MongoDB driver.
- Sampling is bounded by size, time, path count, and nesting depth and iterates
  with cursor operations rather than materializing an unbounded result.
- Only inferred metadata crosses typed, sender-checked, zod-validated IPC.
- Database values/examples remain canonical EJSON data; no renderer evaluation
  or HTML injection is used.
- Driver method suggestions are sourced from installed declarations, satisfying
  the no-hand-maintained-driver-method-list invariant.

## Verification

| Check | Result |
|---|---|
| TypeScript strict check | PASS |
| Unit tests | 160 / 160 PASS |
| Real-mongod integration tests | 33 / 33 PASS |
| AST context tests | 20 / 20 PASS |
| Semantic completion tests | 7 / 7 PASS |
| Schema cache tests | 5 / 5 PASS |
| Installed-driver completion spike | PASS; 28 ms cold, 8 ms warm |
| Query runtime production bundle | PASS |
| Electron Forge arm64 package | PASS |
| Packaged app runtime/storage smoke | PASS |

The next product phase is Phase 5: admin tooling (indexes, explain, global
search, change streams, and GridFS).
