# ADR-0006: Parser & instrumentation — TypeScript Compiler API

- Status: Accepted (validated by S3/S7: 31 analysis tests)
- Context: Must split top-level statements correctly (strings, templates, regex, comments, top-level await), capture per-statement results, power completion-context detection, support JS AND TS. Semicolon/regex splitting is forbidden.
- Options: TypeScript Compiler API; acorn; meriyah; tree-sitter; @babel/parser.
- Decision: **TS Compiler API** (`ts.createSourceFile`, error-tolerant, full ranges) as the single parser shared by runtime instrumentation, run-current-statement resolution, and completion-context classification (`src/features/script-analysis/`, pure package). acorn rejected (JS-only → second parser for TS); tree-sitter rejected (wasm/native packaging); babel rejected (duplicates TS semantics).
- Statement attribution: expression statements become `await __mongogCapture(i, async () => ( expr ))` ; all other statements get a cheap `__mongogMark(i)` prefix for exact error attribution; whole program in one async IIFE → sequential execution, shared variable scope, top-level await. `{ a: 1 }` at statement start is a Block — never captured (REPL semantics, tested).
- Consequences: one grammar, consistent ranges; the ~8 MB TS package runs in runtime/worker, never blocking the UI thread.
- Risks: parse latency on very large scripts. Revisit: >150 ms p95 on 5,000-line scripts → incremental AST caching or Monaco TS-worker plugin.

## Automatic-await lowering

`auto-await.ts` lowers expressions with the TypeScript AST before JS emission.
Value reads conditionally suspend only for thenables. Receiver and callee
evaluation occur before arguments, with temporaries preserving `this` and
optional-chain short circuits. A synchronous fast path around ordinary function
bodies preserves synchronous return/throw behavior until a wait is reached;
completion is recorded after user `finally` blocks. Constructors, setters and
synchronous generators use a rejecting synchronous guard instead.

Array callback helpers preserve sequential iteration, holes, early exits and
receiver semantics. `for...of` uses an iterator adapter with `return()` cleanup.
Explicit Promise combinators construct independent input jobs; runtime identity
checks avoid treating a shadowed `Promise` object as the built-in combinator.
Generated helpers are not fed back through the visitor. Policy checks run before
lowering, against the original AST.

The internal instrumented program includes a type-only automatic-await projection,
transformation diagnostics, and character-span mappings. The projection applies
`Awaited<T>` at value reads instead of leaking runtime temporary variables into
type inference. It is pure analysis, never executed in the renderer. Original
statement ranges and selection offsets remain authoritative for engine events.
