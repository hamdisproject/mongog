# Bugs — active index

> Each bug is a separate file. Status is tracked in the file frontmatter.
> Convention: `BUG-<nnn>-<slug>.md` with `Status: active | fixed` and `Priority: high | medium | low`.

| ID | Title | Priority | Status | File |
|----|-------|----------|--------|------|
| BUG-001 | Read-only protection bypassable via computed access / aliasing | high | fixed | [BUG-001-readonly-policy-bypass.md](BUG-001-readonly-policy-bypass.md) |
| BUG-002 | better-sqlite3 native ABI mismatch breaks unit tests / dev start | medium | active | [BUG-002-better-sqlite3-abi.md](BUG-002-better-sqlite3-abi.md) |
| BUG-003 | Secure vault fail-closed blocks profiles (macOS ad-hoc sign, Linux basic_text) | high | active | [BUG-003-vault-fail-closed.md](BUG-003-vault-fail-closed.md) |
| BUG-004 | Monaco 0.56 + TS-pinned type manifest is fragile (stale completions) | medium | active | [BUG-004-monaco-types-fragility.md](BUG-004-monaco-types-fragility.md) |
| BUG-005 | Runtime cap (10) + cursor idle TTL (10m) cause surprise evictions | medium | active | [BUG-005-runtime-cap-cursor-ttl.md](BUG-005-runtime-cap-cursor-ttl.md) |

## Workflow

1. Pick a bug, reproduce from its `Evidence` section.
2. Fix per `Suggested fix`, add unit + integration tests where applicable.
3. Set file `Status: fixed` with fix commit + verification numbers.
4. Do not delete fixed files; they are history.
