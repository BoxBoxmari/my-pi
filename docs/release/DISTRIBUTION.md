# my-pi — Packaging & Distribution Specification

**Package Name:** `my-pi`  
**CLI Binaries:** `my-pi-mcp` (primary), `ccr-mcp` (deprecated 1-major alias)  
**Target Registry:** npm / GitHub Packages  
**Supported Node Engine:** `>=22.6.0` (tested on Node 22 LTS and Node 24 LTS)

---

## 1. Package Contents Allowlist

The distributed npm tarball (`apps/my-pi-mcp`) must contain exclusively:

- `dist/main.js` (with `#!/usr/bin/env node` shebang)
- `dist/**/*.js` and `dist/**/*.d.ts`
- `package.json`
- `LICENSE`
- `README.md`

Excluded from tarball:
- Source `.ts` files (except definitions)
- Test suites (`*.test.ts`, `tests/`)
- Benchmark fixtures (`fixtures/`)
- Engineering logs (`evidence/*.log`)
- Agent & harness metadata (`.agent/`, `.agt/`, `.knowns/`, `.x-harness/`)

---

## 2. Installation & Execution

```bash
# Global installation
npm install -g my-pi

# Run MCP server
my-pi-mcp --workspace /path/to/project

# Direct execution via npx
npx my-pi --workspace /path/to/project
```