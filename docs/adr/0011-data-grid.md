# ADR-0011: Data grid — TanStack Table + TanStack Virtual (MIT)

- Status: Accepted
- Context: Virtualized rows, dynamic columns, nested-field expansion, copy cell/row/selection, BSON-aware cells; no commercial gating for core features.
- Options: AG Grid Community, TanStack Table + Virtual, Glide Data Grid.
- Decision: **TanStack Table v8 + TanStack Virtual** (headless, MIT). AG Grid Community rejected: clipboard, range selection, tree data and server-side row model are ALL Enterprise-licensed — exactly MongoG's core needs (verified on the official licensing page). Glide rejected: canvas rendering complicates nested expansion and custom BSON cell UX. Nested expansion is our own flattening layer (dot-path rows + expansion state).
- Consequences: full license freedom; full rendering control; more code than a batteries-included grid (accepted).
- Risks: DOM limits at extreme cell counts. Revisit: >50k visible cells → Glide evaluation for a dedicated "large results" mode only.
