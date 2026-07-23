# ADR-0012: Credential storage — safeStorage ASYNC API

- Status: Accepted (validated by S10 on macOS Keychain)
- Context: Passwords/URIs-with-creds/AWS keys/cert passphrases must never be plaintext on disk; profiles and history never contain secrets.
- Decision: **`safeStorage.encryptStringAsync`/`decryptStringAsync`** — explicitly recommended by current Electron docs (non-blocking, key rotation via `shouldReEncrypt` → transparent re-encrypt, temporary-unavailability handling). Secrets encrypted in main, stored as base64 blobs keyed by profileId (SQLite secrets table from Phase 1); decrypted material exists only in main memory, sent to the runtime over the private process channel at connect time; never logged (redaction pipeline, unit-tested).
  - Linux `basic_text` backend → modal warning + per-profile "ask on each connect" option.
  - Decrypt failure → profile `needsReauth`; error category `SecureStorageFailure`.
- Consequences: `SecretVault` (src/main/security/secret-vault.ts) isolates the mechanism behind an interface (future KMS providers).
- Risks: platform keychain quirks. Revisit: enterprise keyring requirements → pluggable SecretProvider implementations.
