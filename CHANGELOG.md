# Changelog

All notable changes to **my-pi** will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security and runtime hardening
- Made the default workspace profile read-only; writes and LSP processes require an explicit trusted profile.
- Added byte-correct LSP framing, workspace-bound navigation, sanitized LSP environments, and shell-free process spawning.
- Added byte-bounded streaming reads, streamed VCS diff spillover, sensitive-path filtering for Git diffs, and private expiring artifact storage.
- Added incremental search traversal, nested `.gitignore` handling, explicit AST query failures, resource limits, secret scanning, and immutable CI action references.

## [0.1.0-alpha.1] - 2026-09-02

### Added
- Model Context Protocol (MCP) stdio server conforming to schema era 2025-11-25.
- 13 core tools: `workspace_info`, `fs_read`, `fs_write`, `fs_patch`, `fs_stat`, `search`, `ast_search`, `lsp_status`, `lsp_navigate`, `lsp_symbols`, `lsp_diagnostics`, `vcs_status`, `vcs_diff`.
- Compare-And-Swap (CAS) mandatory file mutations using SHA-256 fingerprints.
- Sensitive path pre-read enforcement denying credential access before file descriptor allocation.
- Multi-language Tree-Sitter AST syntax search (TS, JS, Python, Rust, Go).
- Multi-language LSP server lifecycle manager (TS, Python, Rust, Go).
- Fail-closed release admission verifier (`scripts/verify-release.mjs`).
- Complete CI matrix running across Windows, Linux, and macOS.
