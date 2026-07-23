# ADR-0006: Parser & instrumentation — TypeScript Compiler API

- Status: Accepted (validated by S3/S7: 31 analysis tests)
- Context: Must split top-level statements correctly (strings, templates, regex, comments, top-level await), capture per-statement results, power completion-context detection, support JS AND TS. Semicolon/regex splitting is forbidden.
- Options: TypeScript Compiler API; acorn; meriyah; tree-sitter; @babel/parser.
- Decision: **TS Compiler API** (`ts.createSourceFile`, error-tolerant, full ranges) as the single parser shared by runtime instrumentation, run-current-statement resolution, and completion-context classification (`src/features/script-analysis/`, pure package). acorn rejected (JS-only → second parser for TS); tree-sitter rejected (wasm/native packaging); babel rejected (duplicates TS semantics).
- Instrumentation (validated): expression statements become `await __mongogCapture(i, async () => ( expr ))` (trailing `;` stripped); all other statements get a cheap `__mongogMark(i)` prefix for exact error attribution; whole program in one async IIFE → sequential execution, shared variable scope, top-level await. `{ a: 1 }` at statement start is a Block — never captured (REPL semantics, tested).
- Consequences: one grammar, consistent ranges; the ~8 MB TS package runs in runtime/worker, never blocking the UI thread.
- Risks: parse latency on very large scripts. Revisit: >150 ms p95 on 5,000-line scripts → incremental AST caching or Monaco TS-worker plugin.
