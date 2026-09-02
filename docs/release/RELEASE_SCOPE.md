# my-pi — Release Scope & Admission Policy

**Target Channel:** `alpha`  
**Current Release:** `v0.1.0-alpha.1`  
**Schema Version:** `1`

---

## 1. Release Scope Objective

This document defines the machine-verifiable scope for the public preview release of **my-pi**.

The goal of the `v0.1.0-alpha.1` release is to provide an independently installable, zero-cost, deterministic coding capability substrate over Model Context Protocol (MCP) stdio with strict file safety, AST structural search, and multi-language LSP support.

---

## 2. Capability Matrix

| Capability / Gate | Status | Release Blocking | Notes |
|---|---|---|---|
| **MCP 13-Tool Surface (G1, G6)** | SUPPORTED | YES | All 13 tools discoverable and operational over stdio |
| **Filesystem Safety & CAS (G3, R0)** | SUPPORTED | YES | SHA-256 CAS required; no-clobber creation; mode bit & encoding preserved |
| **Sensitive Path Pre-Read (G2, R0)** | SUPPORTED | YES | Credentials (.env, .aws, .ssh) denied prior to file descriptor allocation |
| **AST Structural Engine (G4)** | SUPPORTED | YES | 5 languages (TypeScript, JavaScript, Python, Rust, Go) |
| **LSP Language Engine (G5)** | SUPPORTED | YES | TypeScript, Python, Rust, Go lifecycle management |
| **VCS Status & Diff (G4)** | SUPPORTED | YES | Git-backed status and diff with artifact spillover |
| **Supply-Chain Integrity (G0)** | SUPPORTED | YES | CycloneDX SBOM, cargo-deny licenses, zero critical vulnerabilities |
| **Native Rust Acceleration (G0, G2)** | DEFERRED | NO | Experimental scaffold only; pure Node.js fallback is authoritative |

---

## 3. Admission Gate Verification

The release qualification is strictly enforced by:

```bash
node scripts/verify-release.mjs
```

Which validates that all required criteria in `release/release-policy.json` are marked as `PASS` in `evidence/*.json`.