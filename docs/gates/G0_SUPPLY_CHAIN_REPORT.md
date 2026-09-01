# G0 — Supply Chain & Supplier Qualification

Status: **PARTIAL / BLOCKED** (tooling + upstream access).

## Committed artifacts (structured, honest)
- `provenance/UPSTREAM.lock.json` — pinned Pi v0.84.4 / b79e4cc…, OMP v18.0.11 / b8ce33a… (MIT).
- `provenance/EXTRACTION_MAP.json` — source-level inheritance map.
- `provenance/SUPPLIER_DEPENDENCIES.json` — supplier candidate inventory; **none promoted**.
- `provenance/THIRD_PARTY_NOTICES.md` — provenance position; explicitly **not** a completed audit.
- `provenance/SBOM.cdx.json` — placeholder, **must be regenerated** from live lockfiles.

## Supplier candidate decisions (documented, not qualified)
| Candidate | Decision | Notes |
|---|---|---|
| `pi-walker` | candidate — pending qualification | search walker/glob |
| `pi-ast` | candidate — pending build/size/grammar/transitive audit | ast_search read-only |
| `pi-vcs` | candidate — prefer narrower `gix` if `jj-lib` cost excessive | vcs_status/diff |
| `pi-natives` | **rejected** (monolith) | no wholesale dependency |
| OMP `grep.rs` | reference only | minimal owned search crate if not cleanly reusable |
| OMP Hashline / LSP | adapt under CCR interfaces | single-file semantics |

## Required checks NOT yet executed
- `cargo deny` / transitive license inventory: **not run**.
- `cargo audit` / RustSec advisory: **not run**.
- Node dependency advisory (`pnpm audit`): **not run**.
- SBOM generation from resolved lockfiles: **not run**.

## Why
These require the upstream OMP crates to be cloned/built and the scan tooling installed, which are external/network-dependent actions not completed in this scaffold phase.

## Guardrails in effect
- Production packages depend only on `@ccr/contracts|policy|observability` (TS) and `@modelcontextprotocol/sdk`+`zod` (adapter only).
- No OMP harness/provider/ToolSession/`pi-natives` dependency exists in the dependency graph.
- No supplier crate is marked accepted; promotion evidence (exact rev, graph, licenses, advisories, size, portability, API subset, replacement path) is recorded as a requirement but **unmet**.
