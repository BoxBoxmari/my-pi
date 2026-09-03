# my-pi

<p>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/v/%40koonwang03%2Fmy-pi?label=npm&logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@koonwang03/my-pi"><img src="https://img.shields.io/npm/dm/%40koonwang03%2Fmy-pi?label=downloads&logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/BoxBoxmari/my-pi/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/BoxBoxmari/my-pi/blob/main/LICENSE"><img src="https://img.shields.io/github/license/BoxBoxmari/my-pi" alt="License" /></a>
</p>

`my-pi` is a local-first Model Context Protocol server for safe workspace inspection, search, AST queries, language-server navigation, and version-control diagnostics.

## Install and run

```bash
npm install -g @koonwang03/my-pi
my-pi-mcp --workspace /path/to/project
```

The package includes the bundled MCP executable and its runtime dependencies. Language-server integrations for TypeScript, Python, Rust, and Go use compatible server executables that must be installed separately in the host environment when those features are needed.

The primary executable is `my-pi-mcp`; `ccr-mcp` is retained as a compatibility alias.
