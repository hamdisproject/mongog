# ADR-0003: State management — Zustand

- Status: Accepted
- Context: Many tabs, async IPC state, TTL'd metadata caches, transient execution state.
- Options: Redux Toolkit, Zustand, Jotai, TanStack Query-centric.
- Decision: **Zustand** with store-per-domain (connections, workspaces/tabs, executions, metadataCache, settings). Persisted slices limited to UI prefs — never secrets or unredacted URIs. TanStack Query considered, but our "server" is streaming IPC, not REST; adopt later only if cache semantics get unwieldy.
- Consequences: tiny API surface; usable outside React (service singletons); no provider boilerplate.
- Risks: cross-tab derived-state subscription storms. Revisit: if profiling shows selector churn → TanStack Query evaluation or selector audit.
