# my-pi — Packaging & Distribution Specification

**Package Name:** `@koonwang03/my-pi`
**CLI Binaries:** `my-pi-mcp` (primary), `ccr-mcp` (deprecated 1-major alias)  
**Intended Registry:** npm / GitHub Packages
**Current workflow state:** qualification artifacts are uploaded by GitHub Actions; registry publication remains a manual follow-up.
**Supported Node Engine:** `>=22.6.0` (Node 22 and Node 24 qualification lanes are configured; candidate run evidence is retained by the release workflow)

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

The release smoke path validates this allowlist from the TGZ itself, then
installs that same TGZ into a fresh consumer directory. Release qualification
must pass the existing artifact to `scripts/pr-smoke.mjs --artifact`; it must
not repack before testing.

The release workflow retains `release-manifest.json` alongside `SHA256SUMS.txt`,
the candidate-bound SBOM, benchmark result, and evidence documents. The
manifest records the exact TGZ and SBOM digests plus the candidate commit.

---

## 2. Installation & Execution

```bash
# Global installation
npm install -g @koonwang03/my-pi

# Run MCP server
my-pi-mcp --workspace /path/to/project

# Direct execution via npx
npx --yes --package @koonwang03/my-pi@0.1.0-alpha.1 my-pi-mcp --workspace /path/to/project
```
