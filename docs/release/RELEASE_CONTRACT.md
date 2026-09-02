# my-pi — Release Contract Specification

**Release Channel:** `alpha`  
**Version:** `v0.1.0-alpha.1`  
**Contract Generation:** `1.1`

---

## 1. Semantic Versioning Contract

1. `my-pi` adopts Semantic Versioning (`MAJOR.MINOR.PATCH-PRERELEASE`).
2. Public preview begins with `v0.1.0-alpha.1`.
3. Breaking changes to the 13-tool MCP JSON schema will increment MINOR during pre-1.0 and increment MAJOR post-1.0.

---

## 2. Invariant Commitments

- **Zero-Inference Guarantee:** No core tool execution relies on paid third-party LLM APIs.
- **Fail-Closed File Security:** File mutations without valid `expected_hash` on existing files are rejected.
- **Path Containment:** Traversals escaping the workspace root or attempting to read sensitive paths return typed errors.
- **Deterministic Stdio:** All tool interactions conform to Model Context Protocol (MCP) schema version 2025-11-25.