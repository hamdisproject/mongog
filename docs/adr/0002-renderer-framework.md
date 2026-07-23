# ADR-0002: Renderer framework — React 19 + TypeScript strict (~5.9)

- Status: Accepted
- Context: Complex IDE UI (Monaco, virtualized tree/grid, long-lived tabs).
- Options: React 19, Vue 3, Solid, Svelte.
- Decision: **React 19 + TypeScript strict** (`noUncheckedIndexedAccess`, `noImplicitOverride`). TS pinned `~5.9.3`: `typescript@7` (native compiler) just shipped and the lint/test toolchain is unproven against it. Monaco 0.56 bundles its own TS service regardless. Evaluate TS 7 for type-check speed later.
- Consequences: predictable patterns; StrictMode-compatible stores required; `@types/react` 19.
- Risks: none material. Revisit: never for v1.
