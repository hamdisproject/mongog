# ADR-0004: Query-runtime topology — one utilityProcess per active connection (bounded pool)

- Status: Accepted (validated by S1/S2/S8/S9)
- Context: Need connection pooling inside the runtime, fault isolation, honest cancellation (incl. kill), cursor/session lifetime, many simultaneous connections, memory discipline.
- Options: (1) one shared runtime; (2) one per active connection; (3) one per query tab; (4) free-form pool.
- Decision: **(2)** with lazy spawn, idle-timeout shutdown (15 min), hard cap (10, configurable). Rationale:
  - (1) mixes faults and pools; one crash kills every connection; per-connection cancellation impossible without collateral damage.
  - (3) duplicates MongoClients per tab (pool exhaustion); sessions/cursors can't span tabs sanely; worst memory.
  - (4) routing complexity without benefit over (2)+caps.
  - Per-connection gives clean cursor/session/transaction ownership, kill = cancel-everything on exactly one connection, and matches driver `MongoClient` semantics.
- Consequences: `RuntimeSupervisor` (src/main/runtime/supervisor.ts) implements ensure/touch/dispose/evictIdle/restart-on-demand; memory stays flat via idle eviction (~70–120 MB per live runtime).
- Risks: first-query spawn latency (~100–300 ms, mitigated by warm-up on connect); cap pressure with many connections.
- Revisit condition: memory profiling >1.5 GB at cap → shared runtime groups keyed by deployment.
