# Security model (authoritative rules for AI changes)

Threat model: the local machine is trusted; the MongoDB server may grant more
privilege than the UI profile suggests; user scripts in Trusted Mode are
**trusted local code, not sandboxed** (`docs/adr/0005-script-execution-model.md`).
The `utilityProcess` is a blast-radius boundary (killable, env-scrubbed, no
persistence/`safeStorage` access) — not an OS sandbox.

## 1. Secrets — never plaintext, fail closed

- Storage: credentials live ONLY as encrypted blobs via `SecretVault`
  (`src/main/security/secret-vault.ts`, `SecretsRepo` backing). Envelope
  prefixes `mongog:v1:async` (primary, `safeStorage.encryptStringAsync`),
  `mongog:v1:sync` (legacy), `mongog:v1:mac-keychain` (darwin fallback).
  Status: `available | unavailable | plain-text-fallback`.
- Fail-closed: when `safeStorage` is unavailable (ad-hoc-signed macOS, Linux
  `basic_text`), credentialed profiles are BLOCKED with `needsReauth` — never
  silently downgraded to plaintext. See
  `docs/bugs/BUG-003-vault-fail-closed.md`.
- URIs: profiles store the URI **without userinfo**. `assertUriHasNoCredentials`
  throws before persisting a profile or history entry that embeds credentials.
  Secrets travel to the runtime only in-memory at connect time.
- Redaction (`src/shared/redaction/index.ts`) — call on EVERY boundary:
  - `redactUri(uri)` before any log, error, history, profile row, or IPC payload.
  - `redactForLog(value)` for structured log payloads.
  - `containsKnownSecretMaterial(value)` as a guard before SQLite writes
    (deliberately narrow so `{ token: "hashed-value" }` document data still works).
- Forbidden: passwords, credentialed URIs, certs, tokens in SQLite, logs,
  history, renderer state (all 12 Zustand stores), or IPC. `grep` for
  `mongodb://[^ ]*@` in any new output path before shipping.

## 2. IPC / renderer boundary

- Preload exposes explicit typed methods only (`MongoGDesktopApi`,
  `src/preload/preload.ts`); every payload is zod-validated in
  `src/main/ipc/registry.ts`; sender frames are checked against
  `allowedRendererOrigins()` (`mongog://bundle` + dev-server origin).
- Renderer renders DB values as DATA only — no `innerHTML`, no `eval`,
  no `new Function` (ESLint bans `eval`/`implied-eval`/`new-func`).
- Renderer assets come only from the bounded `mongog://bundle` protocol
  (`src/main/window.ts:38-…`): host must be `bundle`, path traversal rejected
  (`..` → 403). Keep `GrantFileProtocolExtraPrivileges` OFF. No remote content.

## 3. Read-only — layered in-app enforcement, server-authoritative roles

- Layer 1 (UX): renderer disables mutating buttons for `readOnly` profiles.
- Layer 2 (enforced): `requireWritableConnection()` in
  `src/main/ipc/handlers.ts` blocks CRUD IPC ops and derives script/SQL
  `readOnly` from the saved profile; renderer input cannot downgrade it.
- Layer 3 (early error): the static AST scan in
  `src/query-runtime/engine/policy.ts` reports literal writes with source ranges.
- Layer 4 (runtime enforcement): `read-only-guard.ts` recursively proxies real
  driver objects in `sandbox.ts`. It covers computed access, aliases,
  `use()`/`getSiblingDB()`, dynamic commands, `$out`/`$merge`, GridFS and clients
  created through trusted `require('mongodb')`.
- BUG-001 is fixed. Keep the static scan and runtime guard together. MongoDB
  server roles remain the final authorization boundary because Trusted Mode is
  trusted local code, not an OS sandbox. Use a server `read` role when writes
  must be impossible regardless of application behavior.

## 4. Script modes

- Query Mode (default): AST-enforced, no `require`/`process`/timers/`fetch`;
  read-only static scan plus runtime driver-object guard (see §3).
- Trusted Mode: allowlisted `require('mongodb' | 'bson')` only + explicit
  consent UX. Copy must stay: "equivalent to running trusted local code;
  **not a sandbox**". `vm` escape CVEs are mitigated by keeping Electron
  current, not by claiming isolation.
- Policy scans inspect the ORIGINAL AST; automatic-await is not a security
  boundary (`docs/query-scripts.md`).
