# my-pi

<p>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/v/%40koonwang03%2Fmy-pi?label=npm&logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/dm/%40koonwang03%2Fmy-pi?label=downloads&logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/blob/main/LICENSE"><img src="https://img.shields.io/github/license/BoxBoxmari/my-pi" alt="License" /></a>
</p>

**my-pi** is a local-first Model Context Protocol (MCP) runtime for coding agents that need controlled access to a real codebase without handing the agent an unrestricted shell.

It combines bounded filesystem operations, content-preconditioned writes, structural AST search, language-server navigation, Git status/diff tooling, and an explicit read-only-by-default security model behind one stdio MCP server.

## Why my-pi

- **Local-first:** source code and detailed workspace state stay on the host.
- **Read-only by default:** mutation and language-server process startup require explicit elevation.
- **Safer writes:** updates can be guarded by content fingerprints instead of blind overwrites.
- **Code-aware navigation:** Tree-Sitter AST search plus LSP symbols, definitions, references, hover, and diagnostics.
- **Git-aware context:** bounded status and diff capabilities without exposing an unrestricted command runner.
- **Host-neutral:** designed for MCP-capable coding environments including Claude Code, Cursor, and OpenCode.

## Install and run

Requires Node.js `>=22.6.0`.

```bash
npm install -g @koonwang03/my-pi
my-pi-mcp --workspace /path/to/project
```

Or inspect a generated host configuration without a global install:

```bash
npx --yes --package @koonwang03/my-pi my-pi-mcp host-config cursor-local
```

The server starts in the read-only security profile. Enable writes and language-server processes only for a trusted workspace:

```bash
my-pi-mcp --workspace /path/to/project --security-profile trusted
```

Starting without `--workspace` or `MY_PI_WORKSPACE_ROOT` fails closed. Use `--allow-cwd` only as an intentional opt-in to the current directory.

## Core MCP capabilities

The stable alpha surface exposes 13 tools across four groups:

- **Filesystem:** `fs_read`, `fs_write`, `fs_patch`, `fs_stat`
- **Search/workspace:** `search`, `workspace_info`
- **AST/LSP:** `ast_search`, `lsp_status`, `lsp_symbols`, `lsp_navigate`, `lsp_diagnostics`
- **Git:** `vcs_status`, `vcs_diff`

Structural AST search supports TypeScript, JavaScript, Python, Rust, and Go. LSP integrations support TypeScript, Python, Rust, and Go when compatible language-server executables are available on the host.

## Generate host configuration

```bash
my-pi-mcp host-config claude-code-local
my-pi-mcp host-config cursor-local
my-pi-mcp host-config opencode-current-local
```

## Security model

`my-pi` uses explicit workspace authority and pre-read sensitive-path policy. The default profile is intentionally restrictive; trusted mode is an explicit opt-in for mutation and language-server processes.

Review the full security model before enabling trusted mode:

https://github.com/BoxBoxmari/my-pi/blob/main/docs/SECURITY_MODEL.md

## Project status

Current release channel: **alpha**. The package is intended for evaluation and controlled local development while coordination/evaluation features under the repository's "Production Next" work remain experimental.

Repository, architecture, benchmarks, release evidence, and contribution details:

https://github.com/BoxBoxmari/my-pi

The primary executable is `my-pi-mcp`; `ccr-mcp` is retained as a compatibility alias.
