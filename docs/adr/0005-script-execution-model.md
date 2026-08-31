# ADR-0005: Script execution model — vm context inside the per-connection utility process

- Status: Accepted (validated by S3)
- Context: Two required modes (Query / Trusted Script); must run the REAL driver; must be honest about security.
- Options: vm context in utility process; direct import() eval; child_process; worker_threads.
- Decision: **`node:vm` context in the utility process** with real driver objects injected: `mongodb`, `bson`, `client`, `db`, `use()`, `print`, `printjson`, captured `console`.
  - Query Mode (default): no require/process/timers/fetch (AST-enforced, `policy.ts`); read-only write scan.
  - Trusted Mode: allowlisted `require` (`mongodb`, `bson` only) + explicit consent UX. Copy: "equivalent to running trusted local code; **not a sandbox**".
  - The utilityProcess is the blast-radius boundary (killable, env-scrubbed, no persistence/safeStorage access); we do NOT claim OS-level sandboxing.
- Consequences: every current AND future driver method is callable; driver upgrades need no query-layer changes (only the ADR-0007 manifest key changes). No per-method IPC — forbidden by design.
- Risks: vm escape CVEs (trusted mode is trusted code; keep Electron current); infinite loops (engine timeout + supervisor kill; verified S9).
- Revisit condition: untrusted-script requirement appears → OS-sandboxed child process (seccomp/job objects), new ADR.

## Automatic-await execution

Both modes always use the AST automatic-await language described in
[Query scripts](../query-scripts.md). The transformation conditionally awaits
thenable value reads while keeping real driver instances. Function wrappers
preserve synchronous results on paths without waits. Array callback adaptations
are installed only in the script VM; no driver-method registry is introduced.

Waits, calls and loops check the execution scope. Promise combinators keep their
parallel inputs; all returned underlying operations are tracked until settled,
including losing race jobs. A failed execution prevents pending script
continuations from starting additional work. The existing UI-finished versus
actually-settled cancellation protocol is retained. Synchronous-only contexts
and ignored asynchronous native callbacks produce actionable runtime errors.
No new execution mode, IPC channel, persistence field or migration is needed.
