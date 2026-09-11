# my-pi — Release Scope & Admission Policy

**Target Channel:** `alpha`  
**Current Candidate:** `v0.1.0-alpha.2`  
**Schema Version:** `1`

---

## 1. Release Scope Objective

This document defines the machine-verifiable scope for the public preview release of **my-pi**.

The goal of the `v0.1.0-alpha.2` candidate is to ship the independently installable, local-first 13-tool coding capability substrate over Model Context Protocol (MCP) stdio, preserve its file-safety and code-intelligence guarantees, and make the package discoverable through npm and the Official MCP Registry without promoting experimental Production Next capabilities into the stable claim.

---

## 2. Capability Matrix

| Capability / Gate | Status | Release Blocking | Notes |
|---|---|---|---|
| **MCP 13-Tool Surface (G1, G6)** | SUPPORTED | YES | All 13 tools are discoverable over stdio; clean-install smoke exercises representative core tools |
| **Filesystem Safety & CAS (G3, R0)** | SUPPORTED | YES | SHA-256 CAS required; no-clobber creation; mode bit & encoding preserved |
| **Sensitive Path Pre-Read (G2, R0)** | SUPPORTED | YES | Credentials (.env, .aws, .ssh) denied prior to file descriptor allocation |
| **AST Structural Engine (G4)** | SUPPORTED | YES | 5 languages (TypeScript, JavaScript, Python, Rust, Go) |
| **LSP Language Engine (G5)** | SUPPORTED WITH HOST PREREQUISITES | YES | TypeScript, Python, Rust, Go lifecycle orchestration when compatible servers exist |
| **VCS Status & Diff (G4)** | SUPPORTED | YES | Git-backed status and diff with artifact spillover |
| **Supply-Chain Integrity (G0)** | SUPPORTED | YES | Candidate-bound CycloneDX SBOM, cargo-deny licenses, and fail-closed audit gates |
| **npm ↔ MCP Registry identity** | SUPPORTED | YES | release policy, npm package, `mcpName`, `server.json`, and registry package version must remain synchronized |
| **Production Next coordination/evaluation** | EXPERIMENTAL | NO | Present as opt-in candidate surfaces; excluded from the stable 13-tool public claim |
| **Native Rust Acceleration (G0, G2)** | DEFERRED | NO | Experimental scaffold only; pure Node.js fallback is authoritative |

---

## 3. Admission Gate Verification

Release qualification is enforced by:

```bash
node scripts/bind-release-evidence.mjs
node scripts/generate-sbom.mjs
node scripts/verify-sbom.mjs
node scripts/verify-release.mjs --strict
```

The verifier checks required criteria in `release/release-policy.json`, candidate-bound evidence, benchmark/runtime evidence in strict mode, package versions, and MCP Registry manifest identity/version consistency.

Publication is downstream of admission. The publication job may run only through an explicit manual dispatch on `main` with `publish=true`; it publishes the admitted artifact rather than building a new one.
