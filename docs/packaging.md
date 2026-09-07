# Packaging, hardening, and update checklist (Phase 6 area)

Single checklist for the packaged app. Source of truth is code
(`forge.config.mts`, `src/main/window.ts`, `src/main/services/update-service.ts`,
`scripts/verify-packaged-app.mjs`); release ceremony is `docs/RELEASE.md`.
Never weaken a check here to "fix" a build — fix the package instead
(`SECURITY.md`).

## What `npm run package` produces

- Forge + Vite build (entries in `forge.config.mts:167-176`: `src/main/main.ts`,
  `src/preload/preload.ts`, one renderer). `prepackage` regenerates the driver
  type manifest, the runtime bundle, and both icon sets first.
- `out/MongoG-<platform>-<arch>/` with asar + unpacked natives
  (`plugin-auto-unpack-natives`; `better-sqlite3` `.node` stays a real file).
- asar `unpack` keeps `runtime-dist/query-runtime.cjs(+map)` OUTSIDE the archive
  (`forge.config.mts:99-103`) — `utilityProcess.fork()` needs a real file path.
  The main bundle keeps natives external, so production `node_modules` are copied
  into the package (devDependencies pruned). Renaming `src/main/main.ts` or
  `src/preload/preload.ts` breaks entry names silently — don't.
- `rebuildConfig: { force: true }` — Forge ignores the stale `.forge-meta`
  marker left by `npm rebuild better-sqlite3`, otherwise Electron could boot
  with a Node-ABI native binary.
- SQL translation pins `node-sql-parser` 5.4.0 as a dev dependency and imports
  only its MySQL build. Vite bundles that code into the renderer worker and the
  self-contained query runtime. The parser source tree and `node_modules/.vite`
  cache must not enter ASAR; `verify:package` rejects either path.
- Makers: macOS ZIP + DMG (APFS, `ULFO`), Linux RPM only, Windows NSIS via
  `scripts/make-windows-nsis.mjs` (explicitly UNSIGNED — SmartScreen warning is
  expected, not a bug).

## Fuse matrix (`forge.config.mts:178-198`)

| Fuse | Test/E2E builds | Production (`MONGOG_RELEASE=1`) |
|---|---|---|
| `RunAsNode` | OFF | OFF (utilityProcess unaffected) |
| `EnableNodeOptionsEnvironmentVariable` | OFF | OFF |
| `EnableCookieEncryption` | ON | ON |
| `OnlyLoadAppFromAsar` | ON | ON |
| `EnableEmbeddedAsarIntegrityValidation` | ON | ON |
| `GrantFileProtocolExtraPrivileges` | OFF | OFF (renderer stays on `mongog://bundle`) |
| `EnableNodeCliInspectArguments` | **ON** (Playwright `_electron` needs it) | **OFF** |

`MONGOG_RELEASE=1` controls production hardening on every platform;
`MONGOG_SIGN_RELEASE=1` additionally enables the fail-closed macOS
sign/notarize path (requires Apple env — `docs/RELEASE.md`).

## Renderer protocol (`src/main/window.ts`)

- Production assets serve ONLY from `mongog://bundle` (privileged scheme:
  `standard, secure, supportFetchAPI, codeCache`), registered before `app.ready`,
  bounded handler after ready. Host must be `bundle` (404 otherwise); path
  traversal rejected (403); no remote content.
- `validateSender` (`src/main/main.ts:46-50`) accepts only
  `allowedRendererOrigins()`: dev-server origin in dev, `mongog://bundle`
  packaged. `GrantFileProtocolExtraPrivileges` stays OFF — that is what keeps
  `file://` out of the picture.

## `build/` resources that must ship

- `build/app-update.yml` (`provider: generic`, `url: https://mongog.com/update`,
  `updaterCacheDirName: mongog-updater`) is copied as an `extraResource` on
  darwin/win32/linux and read by the updater at download time — `setFeedURL()`
  does NOT remove the requirement. Missing/broken config ⇒ `verify:package`
  rejects on all three platforms. Pre-1.2.8 installs lacking it need one manual
  reinstall (`docs/RELEASE.md`).
- `build/package-type` (`rpm`) ships on Linux only.
- Icons: default macOS `assets/mongog-icon.icns` (compact, 824 px optical
  envelope in the 1024 px master; `.icon` sources are design archives, not
  shipped); Windows `assets/windows/mongog-icon.ico` (16–256 px tiers).
  `npm run verify:icons` validates bounds/tiers/containers.

## Verify before calling a package good

```bash
npm run verify:package -- --platform darwin --arch arm64   # fuses, asar, natives, app-update.yml
npm run smoke:packaged -- --platform darwin --arch arm64   # boots the packaged app headless
MONGOG_SMOKE=1 MONGOG_SMOKE_MONGO_URI=<external-mongod-uri> out/…/MongoG
```

The packaged smoke NEVER starts `mongodb-memory-server` (throws by design) —
start mongod externally and pass its URI. `MONGOG_SMOKE_MONGO_URI` is the only
supported DB path for packaged smoke (`docs/debugging.md` §6).

## Updater contract (`src/main/services/update-service.ts`)

- `electron-updater`, generic provider pointed at `MONGOG_UPDATE_FEED_URL`
  (default `https://mongog.com/update`). No platform ever installs merely
  because the app quits — installation always needs an explicit action.
- macOS + RPM Linux: read `/update/latest-mac.yml` / `/update/latest-linux.yml`,
  prompt BEFORE downloading (consent-driven).
- Windows: reads `/update/latest.yml` only to detect a newer version. It keeps
  `autoDownload` and install-on-quit disabled, never calls the updater download
  or install methods, and directs the user to `https://mongog.com/releases`.
  The manually downloaded NSIS installer remains unsigned by policy.
- Status mirrors to the renderer via `IpcEvents.updateStatus`
  (`idle | checking | available | downloading | downloaded | error` phases)
  together with the trusted `in-app | website` delivery policy.
- A release is publishable only when six artifacts + three manifests deploy
  together (2 macOS DMG + 2 macOS ZIP + 1 Windows NSIS + 1 RPM;
  `latest-mac.yml`, `latest.yml`, `latest-linux.yml` generated from actual
  SHA-512s by `scripts/generate-update-manifests.mjs`). Never activate a
  version with a partial `/update` deploy.

## Touching packaging? Read first

`forge.config.mts` (whole file, 202 lines) → `scripts/verify-packaged-app.mjs`
(what "good" means) → `tests/unit/release/*` (update-config, artifacts,
workflows, icons — CI asserts on these) → `docs/RELEASE.md` (ceremony).
