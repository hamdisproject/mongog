# scripts/ index (what each script does — run from repo root)

Build/regen scripts are wired into `prestart`/`prepackage`; the rest are
manual checks. Shared CLI parsing + release naming live in `release-utils.mjs`
(+ `.d.mts` types); icon pixel math lives in `macos-icon-utils.mjs` /
`windows-icon-utils.mjs`.

| Script | Run via | Purpose |
|---|---|---|
| `extract-mongo-types.mjs` | `npm run extract:types` (auto: prestart, prepackage, pretypecheck) | Crawls the INSTALLED `mongodb`+`bson` `.d.ts` graph → `src/renderer/generated/` manifest for Monaco completions (ADR-0007). Re-run after any driver/bson/monaco bump |
| `spike-monaco-types.mjs` | `npm run spike:monaco-types` | S6 check: manifest gives working completions in a real TS language service; budgets cold < 3000 ms / warm < 300 ms |
| `spike-safestorage.cjs` | `npm run spike:safestorage` | S10 check: `safeStorage` async API + backend status (run under Electron: `electron scripts/spike-safestorage.cjs`) |
| `spike-runtime-debug.cjs` | manual (`electron …`) | Debug helper for the query runtime outside the full app |
| `build-macos-icns.mjs` | `npm run build:icons` (auto: prepackage) | Compact macOS ICNS from the padded master |
| `build-windows-ico.mjs` | `npm run build:icons` (auto: prepackage) | Full-canvas multi-resolution Windows ICO (16–256 px) |
| `verify-macos-icons.mjs` | `npm run verify:icons` (auto: prepackage) | Optical bounds + container validation for ICNS |
| `verify-windows-icons.mjs` | `npm run verify:icons` | Tier + container validation for ICO |
| `verify-packaged-app.mjs` | `npm run verify:package -- --platform … --arch …` | Fuses, asar layout, unpacked natives, `app-update.yml` — rejects bad packages on all platforms |
| `run-packaged-smoke.mjs` | `npm run smoke:packaged -- …` | Boots the packaged app headless (`MONGOG_PACKAGED_EXECUTABLE` override supported) |
| `make-windows-nsis.mjs` | `npm run make:windows:nsis` | Unsigned Windows x64 NSIS installer — must run ON Windows x64, throws elsewhere |
| `make-macos-dmg.mjs` | release flow | macOS DMG assembly |
| `collect-release-artifacts.mjs` | `npm run collect:release` | Gathers the six platform packages for the draft release |
| `verify-release-assets.mjs` | `npm run verify:release` | Six artifacts + naming (`UNSIGNED` Windows) + completeness |
| `generate-update-manifests.mjs` | `npm run generate:update-manifests` | `latest-mac.yml` / `latest.yml` / `latest-linux.yml` from actual package SHA-512s |
| `materialize-signing-assets.mjs` | release flow (macOS) | Temp keychain/dirs from Apple secrets; cleans up afterwards |
| `validate-release-environment.mjs` | release flow | `package.json` version == tag check + required env presence (fail-closed) |

Rules: never start `mongodb-memory-server` from a packaged binary
(`run-packaged-smoke.mjs` uses an externally provided mongod path);
never commit Apple secret material — it only ever lives in temp dirs at
release time (`docs/RELEASE.md`).
