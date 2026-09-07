# BUG-003 — Secure vault fail-closed blocks profiles (macOS ad-hoc sign, Linux basic_text)

- **ID:** BUG-003
- **Status:** active
- **Priority:** high
- **Area:** main / security / vault / packaging
- **Found:** 2026-09-06 (code inspection)

## Evidence

- `src/main/security/secret-vault.ts:180-184` — `canUseSynchronousFallback()` returns true only for `darwin|win32`; Linux `basic_text` intentionally never accepted.
- `src/main/security/secret-vault.ts:92-117` — `info()` reports `available | unavailable | plain-text-fallback` (+ `backend` on Linux).
- `src/main/security/secret-vault.ts:186-224` — `encrypt()` order: async `safeStorage` → sync fallback (darwin/win32 only) → `MacKeychainSecretStore` → throw `SecureStorageFailure`. No plaintext fallback.
- `src/main/security/mac-keychain-secret-store.ts:75-103` — direct `/usr/bin/security` fallback; header notes it exists because `Chromium's shared Safe Storage key is rejected by its code-signing access control` on ad-hoc packages.
- Phase 1 report note: ad-hoc signed macOS Keychain fail-closed verified; full signed-package Keychain validation deferred to Phase 6.

## Description

Fail-closed is correct for security, but two environments hit it in normal use:

1. **macOS local (ad-hoc signed) package:** Electron `safeStorage` async+sync both fail due to code-signing access control → falls through to `MacKeychainSecretStore` spawn. Works locally, but Team-ID-signed production behavior (migration, re-encrypt via `shouldReEncrypt`, access to pre-existing items) is unverified until Phase 6 signing.
2. **Linux without gnome-keyring/kwallet:** backend is `basic_text` → `info()` returns `plain-text-fallback`, `encrypt()` throws → user cannot save ANY credentialed profile. App blocks with `SecureStorageFailure`.

## Impact

- macOS: risk of production-only regression (cannot read dev-created secrets after signing identity changes; or silent fallback-path divergence).
- Linux: credentialed connections unusable on minimal distros/containers; support burden.

## Expected

- Signed+notarized DMG can read/migrate secrets created by previous signed builds; clear UX when OS store is missing.
- Linux users get actionable guidance instead of a bare failure.

## Suggested fix

1. Phase 6 acceptance: signed DMG → save secret → upgrade/re-sign → read secret; cover `legacy` (pre-envelope) blob + `shouldReEncrypt` path (`secret-vault.ts:161`).
2. `ConnectionsView`: when `vault.info().status !== 'available'`, disable password fields with message + link (Linux: install `gnome-keyring`/`libsecret`; macOS: unlock login keychain — string already exists in `secureStorageError`).
3. Add packaged smoke assertion: `vault.info()` status logged (redacted) in `verify-packaged-app` / `run-packaged-smoke`.
4. Tests: unit matrix for `encrypt()` fallback order per platform (fake `safeStorage` + fake native store); no plaintext blob assertion.

## Related

- `docs/adr/0012-credential-storage.md`
- `docs/RELEASE.md` (Apple secrets / `MONGOG_SIGN_RELEASE=1`)
