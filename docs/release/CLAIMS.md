# my-pi — Public Claims & Evidence Registry

This document records the exact correspondence between public product claims and machine-verifiable evidence.

---

| Feature Claim | Status | Evidence Source | Public Documentation Wording |
|---|---|---|---|
| **13-Tool MCP Surface** | PASS | `evidence/G1.json`, `evidence/G6.json`, `scripts/pr-smoke.mjs` | "Complete 13-Tool MCP Suite supported" |
| **CAS Atomic Mutation** | PASS | `evidence/G3.json`, `packages/workspace-runtime/test/g3-matrix.test.ts` | "Enforces Compare-And-Swap (CAS) with expected_hash" |
| **Sensitive Path Protection** | PASS | `evidence/G2.json`, `packages/search/test/search.test.ts` | "Pre-read security policy denies credential paths" |
| **AST Structural Search** | PASS | `evidence/G4.json`, `packages/ast/test/ast.test.ts` | "Tree-Sitter syntax queries for TS, JS, Python, Rust, Go" |
| **Multi-Language LSP** | PASS | `evidence/G5.json`, `packages/lsp/test/lsp-multi-lang.test.ts` | "Language server lifecycle for TS, Python, Rust, Go" |
| **Git VCS Diff Spillover** | PASS | `evidence/G4.json`, `packages/vcs/test/vcs-spill.test.ts` | "Automatic artifact spillover for diffs exceeding inline limit" |
| **Zero Operating Cost** | PASS | `evidence/G0.json`, `package.json` | "100% local-first execution with zero paid API dependencies" |
| **100k File Traversal** | PASS (Release) | `benchmarks/traversal-benchmark.mjs --profile release` | "Validated up to 100,000 files in tagged release benchmark" |
| **Native Acceleration** | DEFERRED | `release/release-policy.json` | "Experimental / pure Node.js fallback authoritative" |