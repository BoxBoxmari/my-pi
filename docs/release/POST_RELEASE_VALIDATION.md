# my-pi — Post-Release Cleanroom Validation Guide

**Release Version:** `v0.1.0-alpha.2`  
**Execution Context:** Clean external consumer environment (independent of source repository)

---

## 1. Cleanroom Consumer Smoke Protocol

After `v0.1.0-alpha.2` is published to npm and the matching GitHub prerelease exists, run the following verification steps in a clean directory:

### Step 1: Install from Registry

```bash
# In an empty directory
mkdir my-pi-consumer-test
cd my-pi-consumer-test

# Install the exact published package
npm install -g @koonwang03/my-pi@0.1.0-alpha.2
# or
npx --yes --package @koonwang03/my-pi@0.1.0-alpha.2 my-pi-mcp host-config cursor-local
```

### Step 2: Validate Executable Binaries & Shebang

```bash
# Verify host-config output format (the MCP server requires an explicit workspace)
my-pi-mcp host-config cursor-local

# Verify OpenCode host-config output
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

- Confirm source contents and credentials do not appear in VCS diff output or artifact files; workspace-relative paths are used for authoritative results.
- Confirm all error responses use typed error structures (`ERR_PATH_NOT_FOUND`, `ERR_STALE_RESOURCE`, `ERR_PERMISSION_DENIED`, etc.).

### Step 5: Verify Official MCP Registry Discovery

Verify the exact server version after publication:

```bash
curl --fail --silent --show-error \
  "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.BoxBoxmari%2Fmy-pi/versions/0.1.0-alpha.2"
```

The response must identify:

- server name: `io.github.BoxBoxmari/my-pi`
- version: `0.1.0-alpha.2`
- npm package: `@koonwang03/my-pi`

Do not announce an Official MCP Registry listing until this external read succeeds.
