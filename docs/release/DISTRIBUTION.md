# my-pi — Packaging & Distribution Specification

**Package Name:** `@koonwang03/my-pi`
**CLI Binaries:** `my-pi-mcp` (primary), `ccr-mcp` (deprecated 1-major alias)  
**Intended Registries:** npm and Official MCP Registry  
**Publishing model:** release qualification is mandatory; publication is an explicit `workflow_dispatch` action on `main` with `publish=true`. npm and MCP Registry publication use GitHub OIDC after one-time trust configuration.  
**Supported Node Engine:** `>=24.0.0` (Node 24 is normative; `node:sqlite` is part of the supported runtime surface and is covered by the exact-minimum smoke test)

---

## 1. Package Contents Allowlist

The distributed npm tarball (`@koonwang03/my-pi`) must contain exclusively:

- `dist/main.js` (with `#!/usr/bin/env node` shebang)
- `dist/**/*.js`, `dist/**/*.d.ts`, and matching `dist/**/*.map` files
- `package.json`
- `LICENSE`
- `README.md`
- optionally `THIRD-PARTY-NOTICES.txt`

Shipped source maps describe the final bundled JavaScript and may include
embedded source content for debugging; standalone TypeScript implementation
files are not included.

Excluded from tarball:
- Source `.ts` files (except definitions)
- Test suites (`*.test.ts`, `tests/`)
- Benchmark fixtures (`fixtures/`)
- Engineering logs (`evidence/*.log`)
- Agent & harness metadata (`.agent/`, `.agt/`, `.knowns/`, `.x-harness/`)
- Repository-only host examples such as `host-configs/opencode.example.json`

The release smoke path validates this allowlist from the TGZ itself, then
installs that same TGZ into a fresh consumer directory. Release qualification
must pass the existing artifact to `scripts/pr-smoke.mjs --artifact`; it must
not repack before testing.

The release workflow retains `release-manifest.json` alongside `SHA256SUMS.txt`,
the candidate-bound SBOM, benchmark result, and evidence documents. The
manifest records the exact TGZ and SBOM digests plus the candidate commit.

---

## 2. Installation & Execution

Use an unpinned install to receive the currently published npm version:

```bash
# Global installation
npm install -g @koonwang03/my-pi

# Run MCP server
my-pi-mcp --workspace /path/to/project

# Explicitly enable workspace writes and LSP processes
my-pi-mcp --workspace /path/to/project --security-profile trusted

# Direct execution via npx
npx --yes --package @koonwang03/my-pi my-pi-mcp --workspace /path/to/project
```

For release validation, pin the candidate version explicitly; see `POST_RELEASE_VALIDATION.md`.

---

## 3. Controlled Publication

The publication job runs only when all of the following are true:

1. The workflow is started manually with `publish=true`.
2. The workflow runs from `main`.
3. `prepare`, multi-platform `qualify`, and strict `admit` jobs all pass.
4. The npm package metadata, `release/release-policy.json`, and `server.json` agree on package identity and version.

The publication job then:

1. Publishes the already-qualified npm artifact through npm Trusted Publishing / GitHub OIDC if that version is absent.
2. Verifies the published npm version and `mcpName`.
3. Validates and publishes `server.json` through the Official MCP Registry using GitHub OIDC if that server version is absent.
4. Verifies the Registry record.
5. Creates the matching Git tag and GitHub prerelease if absent.

Publication steps are designed to be idempotent so a failed downstream Registry operation can be retried without republishing an existing npm version.

### One-time trust prerequisite

Before the first OIDC publication, the npm package owner must configure `@koonwang03/my-pi` to trust:

- GitHub organization/user: `BoxBoxmari`
- Repository: `my-pi`
- Workflow filename: `release.yml`

This account-level trust configuration cannot be inferred from repository source and is intentionally not stored as a long-lived repository secret.
