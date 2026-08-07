# Phase 5.5 — Welcome and connection experience

Status: **COMPLETE and verified** (2026-08-08)

Phase 5.5 adds a startup Welcome workspace and a full connection-management
experience while keeping credentials and all MongoDB driver activity outside
the renderer. Local demo MongoDB download, embedding, and seed data are
deliberately outside this phase.

## Delivered

- Every application start restores the workspace, reduces persisted Welcome
  tabs to one, creates one if needed, and activates it. Welcome remains
  closeable and can be reopened from Explorer Home.
- Welcome provides New Connection, Open Connections, recent profile/status
  cards, and safe query examples. A recent profile card connects when needed
  and opens a query using the profile default database, the first non-system
  database, or `test` as the final fallback.
- Connections is a singleton master/detail workspace. Its left panel supports
  profile search, group filtering, status/error indicators, create/edit,
  connect/disconnect, and explicit deletion.
- Basic mode covers name, credential-free URI, username/password, default
  database, group, color, and read-only protection. Advanced mode covers auth,
  TLS, read preference, direct connection, retry behavior, timeouts, pool
  limits, and application name.
- Credentialed pasted URIs are immediately split into a credential-free URI
  and transient secure fields. Passwords are never placed in Zustand,
  workspace persistence, profile storage, logs, errors, or IPC responses.
- Editing supports explicit preserve, replace, and clear credential behavior.
  Empty edit passwords preserve the vault secret.
- `testDraft` validates a new or edited draft in an isolated temporary runtime
  without changing the stored profile or current runtime.
- `saveAndConnect` retests server-side, persists only after success, replaces
  the old runtime only after persistence, then reconnects. A final connection
  race reports “saved but connection failed” without rolling back the valid
  profile.
- Deletion explains profile, secret, history, and saved-script effects, then
  clears runtime/store/schema state and detaches related open workspace tabs.
- Explorer's inline profile form was removed. New and edit actions route to
  the Connections workspace; double-click connect/disconnect remains.
- Collection tabs now provide a persistent `Documents | Query` switch. The
  Documents browser keeps its in-tab filter/page/editor state while the Query
  view reuses Monaco and structured Results with connection/database locked
  to the collection namespace. Document and query cursors use separate owner
  identities so running a query does not invalidate browser pagination.
- Documents Filter, Sort, and Projection now live in a default-open,
  collapsible Criteria panel backed by a dedicated Monaco language. Each
  editor starts at one line and grows vertically with its content. All three use
  schema-aware field completion; Filter also provides MongoDB query operators.
  Valid identifier fields are inserted unquoted while dotted or otherwise
  special field names are quoted automatically.
- Criteria accept data-only object-literal syntax such as `{ bikeid: 17827 }`,
  single-quoted strings, comments, and trailing commas. A pure TypeScript-AST
  parser rejects calls, constructors, regex literals, templates, spreads,
  computed/shorthand properties, and executable MongoDB operators. The query
  runtime repeats validation and converts the normalized data through strict
  EJSON; document mutation and Administration fields remain strict EJSON.

## Packaging and security hardening found during acceptance

- The production renderer is served from a registered, standard, secure
  `mongog://bundle` protocol restricted to the packaged renderer directory.
  Traversal and unknown-host requests are rejected. This keeps Electron's
  `GrantFileProtocolExtraPrivileges` fuse disabled and fixes packaged window
  startup under that security setting.
- Renderer initialization is guarded against React StrictMode's repeated
  development effect so a late workspace restore cannot steal focus from the
  user's first Connections interaction.
- E2E data uses an isolated user-data directory and a real test `mongod`; no
  demo server or production data is introduced.

## Verification

| Check | Result |
|---|---|
| TypeScript strict check | PASS |
| Unit tests | 200 / 200 PASS |
| Real-mongod integration tests | 38 / 38 PASS |
| Packaged Electron lifecycle E2E | 1 / 1 PASS |
| Query runtime production bundle | PASS |
| Electron Forge arm64 package | PASS |
| Packaged runtime/storage smoke | PASS |

The next product phase is Phase 6: packaging hardening, signing, distribution,
and updates.
