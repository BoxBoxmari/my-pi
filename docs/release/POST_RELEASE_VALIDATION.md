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
npm install -g @koonwang03/my-pi@0.1.0-alpha.1
# or
npx --yes --package @koonwang03/my-pi@0.1.0-alpha.1 my-pi-mcp host-config cursor-local
```

### Step 2: Validate Executable Binaries & Shebang

```bash
# Verify host-config output format (the MCP server requires an explicit workspace)
my-pi-mcp host-config cursor-local

# Verify host-config output format
my-pi-mcp host-config opencode-current-local
```

### Step 3: MCP Client Discovery & Handshake

Configure an MCP host (Claude Code, Cursor, or OpenCode) and connect via stdio:

1. Confirm 13 tools are advertised:
   - `workspace_info`, `fs_read`, `fs_write`, `fs_patch`, `fs_stat`
   - `search`, `ast_search`
   - `lsp_status`, `lsp_navigate`, `lsp_symbols`, `lsp_diagnostics`
   - `vcs_status`, `vcs_diff`
2. Perform a test `workspace_info` call.
3. Perform a test `fs_read`; use `--security-profile trusted` explicitly before testing CAS `fs_write` or LSP processes.

### Step 4: Confirm Boundary and Error Hygiene

- Confirm source contents and credentials do not appear in VCS diff output or
  artifact files; workspace-relative paths are used for authoritative results.
- Confirm all error responses use typed error structures (`ERR_PATH_NOT_FOUND`,
  `ERR_STALE_RESOURCE`, `ERR_PERMISSION_DENIED`, etc.).
