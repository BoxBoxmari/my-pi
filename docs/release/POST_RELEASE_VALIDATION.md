# my-pi — Post-Release Cleanroom Validation Guide

**Release Version:** `v0.1.0-alpha.1`  
**Execution Context:** Clean external consumer environment (independent of source repository)

---

## 1. Cleanroom Consumer Smoke Protocol

After `v0.1.0-alpha.1` is published to the npm registry or GitHub Releases, run the following verification steps in a clean directory:

### Step 1: Install from Registry

```bash
# In an empty directory
mkdir my-pi-consumer-test
cd my-pi-consumer-test

# Install the published package globally or locally
npm install -g my-pi@0.1.0-alpha.1
# or
npx --yes --package my-pi@0.1.0-alpha.1 my-pi-mcp host-config cursor-local
```

### Step 2: Validate Executable Binaries & Shebang

```bash
# Verify CLI entry responds
my-pi-mcp --help || my-pi-mcp host-config cursor-local

# Verify host-config output format
my-pi-mcp host-config opencode-local
```

### Step 3: MCP Client Discovery & Handshake

Configure an MCP host (Claude Code, Cursor, or OpenCode) and connect via stdio:

1. Confirm 13 tools are advertised:
   - `workspace_info`, `fs_read`, `fs_write`, `fs_patch`, `fs_stat`
   - `search`, `ast_search`
   - `lsp_status`, `lsp_navigate`, `lsp_symbols`, `lsp_diagnostics`
   - `vcs_status`, `vcs_diff`
2. Perform a test `workspace_info` call.
3. Perform a test `fs_read` and CAS `fs_write`.

### Step 4: Confirm Zero Leakage

- Confirm no private host paths (e.g., `C:\Users\...`) appear in error payloads.
- Confirm all error responses use typed error structures (`ERR_NOT_FOUND`, `ERR_CAS_MISMATCH`, etc.).
