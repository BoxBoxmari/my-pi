# my-pi

`my-pi` is a local-first Model Context Protocol server for safe workspace inspection, search, AST queries, language-server navigation, and version-control diagnostics.

## Install and run

```bash
npm install -g my-pi
my-pi-mcp --workspace /path/to/project
```

The package includes the bundled MCP executable and its runtime dependencies. Language-server integrations for TypeScript, Python, Rust, and Go use compatible server executables that must be installed separately in the host environment when those features are needed.

The primary executable is `my-pi-mcp`; `ccr-mcp` is retained as a compatibility alias.
