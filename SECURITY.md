# Security Policy

## Supported versions

Latest packaged release only. Update via the in-app updater (generic feed at
`MONGOG_UPDATE_FEED_URL`, default `https://mongog.com/update`).

## Report a vulnerability

Open a **private** report via the repository's security advisory flow. Do not
file public issues for credential leaks, sandbox escapes, or signature/updater
integrity problems. Include: app version, platform/arch, and redacted logs —
never attach credentialed URIs, `.p12`/`.p8` material, or keychain exports.

## Rules AI contributors must follow

- No secrets (passwords, credentialed URIs, certs, tokens) in SQLite, logs,
  history, renderer state, or IPC. Use `src/shared/redaction/index.ts` on every
  boundary; store credentials only via `SecretVault`.
- No DB code or user scripts in the renderer; no `innerHTML`/`eval`.
- Every IPC payload is zod-validated; sender frames are allowlisted.
- UI `readOnly` is not a security boundary (see `docs/security-model.md` §3 and
  `docs/bugs/BUG-001-readonly-policy-bypass.md`); server-side MongoDB roles are
  authoritative.
- Windows releases are explicitly `UNSIGNED` (SmartScreen warning expected);
  macOS releases are Developer-ID signed + notarized. Never weaken the
  `verify:package` checks or fuse settings to "fix" a build.
