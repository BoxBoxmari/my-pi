# HOST_COMPATIBILITY.md (v1.1 scaffold)

Host differences belong in config/profile/compatibility evidence, not capability logic.

## Release roles
- **Blocking**: Claude Code, OpenCode.
- **Monitoring**: Cursor, Google Antigravity (IDE/CLI), GitHub Copilot (VS Code, CLI, cloud).

## Profiles (`@ccr/host-profiles`, `ccr host-config <id>`)
| Profile | Role | Dialect |
|---|---|---|
| claude-code-local | blocking | claude-code (CLI) |
| opencode-current-local | blocking | opencode |
| opencode-v2-local | monitoring | opencode |
| cursor-local | monitoring | cursor |
| antigravity-ide-local | monitoring | antigravity |
| antigravity-cli-local | monitoring | antigravity |
| copilot-vscode-local | monitoring | copilot-vscode |
| copilot-cli-local | monitoring | copilot-cli |
| copilot-cloud-local-in-agent | monitoring | copilot-vscode |

## Observed MCP era
- **Negotiated era**: `2025-11-25` (empirically observed over stdio handshake using `@modelcontextprotocol/server` v2.0.0; documented in `docs/protocol-evidence.json`).

## Config generator
`ccr host-config <profile>` renders configuration; it never silently mutates host settings.
Verified for `cursor-local` (JSON), `claude-code-local` (CLI), `opencode-current-local` (JSON), and unknown profile error rejection.

## Compatibility status (updated)
- **Both blocking hosts connect to ccr-mcp**:
  - OpenCode `opencode mcp list` → `ccr ✓ connected`.
  - Claude Code `claude mcp list` → `ccr Connected`.
- **All 13 of 13 tools operational over stdio**:
  - Filesystem: `workspace_info`, `fs_read`, `fs_stat`, `fs_write`, `fs_patch`
  - Search: `search` (grep & glob)
  - AST: `ast_search` (Tree-Sitter 5 languages: TS, JS, Python, Rust, Go)
  - LSP: `lsp_status`, `lsp_diagnostics`, `lsp_symbols`, `lsp_navigate` (4 languages: TypeScript, Python, Rust, Go)
  - VCS: `vcs_status`, `vcs_diff`
- Cursor/Antigravity/Copilot: configured in monitoring role (`host-profiles`).

