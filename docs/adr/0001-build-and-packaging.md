# ADR-0001: Build & packaging — Electron Forge + Vite plugin (experimental, risk accepted)

- Status: Accepted (ratified by spikes S1/S8, 2026-07-22)
- Context: Four build targets (ESM main, CJS preload, React renderer, CJS query runtime), HMR dev loop, cross-platform makers. Forge's Vite plugin is officially **experimental** since Forge v7.5.0 (verified still true at 7.11.2); the Webpack plugin is stable but slower and awkward with workers.
- Options: (a) Forge + Webpack + TS; (b) Forge + Vite (experimental); (c) electron-vite + electron-builder.
- Decision: **(b)**, versions pinned (forge 7.11.2, vite ^7), `@vitejs/plugin-react` ^5.2 (v6 requires vite 8, unproven with the plugin).
- Consequences (learned in spikes):
  - plugin-vite wipes `.vite/` before builds → query runtime built to `runtime-dist/`; custom `packagerConfig.ignore` keeps `/.vite` + `/runtime-dist`.
  - Main bundle must declare `build.lib.formats: ['es']` (plugin defaults CJS; package is `"type": "module"`).
  - Preload stays CJS (`preload.cjs`) — sandboxed preloads cannot be ESM.
  - Renderer index.html lives at project root (plugin convention).
- Risks: breaking changes in minor Forge releases; accepted — build tooling only, runtime architecture unaffected.
- Revisit condition: a Forge upgrade breaks the build unfixably within 1 working day, or the Vite plugin is deprecated → migrate to the Webpack plugin (config-only change).
