# my-pi — Release Contract Specification

**Release Channel:** `alpha`  
**Candidate Version:** `v0.1.0-alpha.2`  
**Contract Generation:** `1.2`

---

## 1. Semantic Versioning Contract

1. `my-pi` adopts Semantic Versioning (`MAJOR.MINOR.PATCH-PRERELEASE`).
2. Public preview began with `v0.1.0-alpha.1`; the current candidate is `v0.1.0-alpha.2`.
3. Breaking changes to the stable 13-tool MCP JSON schema will increment MINOR during pre-1.0 and increment MAJOR post-1.0.
4. Experimental Production Next surfaces do not become part of the stable public contract merely by being present in the repository or package candidate.

---

## 2. Invariant Commitments

- **Zero-Inference Guarantee:** No core tool execution relies on paid third-party LLM APIs.
- **Fail-Closed File Security:** File mutations without valid `expected_hash` on existing files are rejected.
- **Path Containment:** Traversals escaping the workspace root or attempting to read sensitive paths return typed errors.
- **Deterministic Stdio:** Stable tool interactions conform to the repository-qualified Model Context Protocol contract.
- **Explicit Authority:** Read-only is the default; workspace mutation and LSP process startup require explicit trusted-profile elevation.
- **Registry Identity Consistency:** `release/release-policy.json`, `apps/my-pi-mcp/package.json`, npm `mcpName`, and root `server.json` must agree on package/server identity and release version before admission.
- **Artifact Continuity:** The npm publication step publishes the artifact that passed release qualification and strict admission; it must not silently repack a different candidate.

---

## 3. Distribution Contract

For an admitted public alpha:

1. npm package identity is `@koonwang03/my-pi`.
2. Official MCP Registry identity is `io.github.BoxBoxmari/my-pi`.
3. npm publication must succeed and expose the expected `mcpName` before the MCP Registry entry is published.
4. The exact Registry version must be externally readable before the project claims Registry availability.
5. Git tag and GitHub prerelease are created only after npm and MCP Registry publication have succeeded.

The publish workflow is intentionally idempotent: if npm publication succeeds but a downstream Registry operation fails, a later retry verifies the existing npm version rather than attempting to overwrite it.
