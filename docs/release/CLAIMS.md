# my-pi — Public Claims & Evidence Registry

This document records the exact correspondence between public product claims and machine-verifiable evidence.

Release-specific claims remain pending until the strict workflow run binds the
evidence, SBOM, benchmark, and exact TGZ to one candidate commit.

---

| Feature Claim | Status | Evidence Source | Public Documentation Wording |
|---|---|---|---|
| **13-Tool MCP Surface** | PASS | `evidence/G1.json`, `evidence/G6.json`, `scripts/pr-smoke.mjs` | "13-tool MCP catalog; clean-install smoke exercises representative core tools" |
| **CAS Atomic Mutation** | PASS | `evidence/G3.json`, `packages/workspace-runtime/test/g3-matrix.test.ts` | "Enforces Compare-And-Swap (CAS) with expected_hash" |
| **Sensitive Path Protection** | PASS | `evidence/G2.json`, `packages/search/test/search.test.ts` | "Pre-read security policy denies credential paths" |
| **AST Structural Search** | PASS | `evidence/G4.json`, `packages/ast/test/ast.test.ts` | "Tree-Sitter syntax queries for TS, JS, Python, Rust, Go" |
| **Multi-Language LSP** | PASS WITH HOST PREREQUISITES | `evidence/G5.json`, `packages/lsp/test/lsp-multi-lang.test.ts` | "Lifecycle orchestration for TypeScript, Python, Rust, and Go when compatible host servers are installed; current evidence fully verifies TypeScript and Python when available." |
| **Git VCS Diff Spillover** | PASS | `evidence/G4.json`, `packages/vcs/test/vcs-spill.test.ts` | "Automatic artifact spillover for diffs exceeding inline limit" |
| **No Paid API Dependency** | PASS | `evidence/G0.json`, `package.json` | "Local-first core with no paid API dependency declared; optional language servers are host-provided" |
| **100k File Traversal** | PENDING RELEASE QUALIFICATION | `benchmarks/traversal-benchmark.mjs --profile release` → candidate-bound `benchmarks/results/traversal-release.json` | Claim becomes release-certified only after the strict release run observes at least 100,000 files for the candidate commit. |
| **Native Acceleration** | DEFERRED | `release/release-policy.json` | "Experimental / pure Node.js fallback authoritative" |
