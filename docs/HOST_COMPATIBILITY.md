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
**None observed.** `V1_MCP_ERA` is a placeholder (`2026-07-28`) pending a G0 probe against the
actual Claude Code and OpenCode versions. Do not treat host support as verified.

## Config generator
`ccr host-config <profile>` renders configuration; it never silently mutates host settings.
Verified for `cursor-local` (JSON), `claude-code-local` (CLI), unknown profile (error).

## Compatibility status (updated)
- **Both blocking hosts connect to ccr-mcp** (real evidence):
  - OpenCode 1.18.21 `opencode mcp list` → `ccr ✓ connected`.
  - Claude Code `claude mcp list` → `ccr … √ Connected`.
- 8 of 13 tools functional over stdio (workspace_info, fs_read, fs_stat, fs_write, fs_patch, search, vcs_status, vcs_diff); AST + LSP still unsupported.
- Exact negotiated MCP era: **unverified** (SDK default placeholder `2026-07-28`); a full same-task run inside each host UI and the era capture remain for a credentialed/CI run.
- Cursor/Antigravity/Copilot: no host run performed (monitoring targets).
