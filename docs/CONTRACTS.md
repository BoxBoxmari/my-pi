# my-pi Contracts (v1.1)

Stable domain contracts, protocol-version independent. Implemented in `@my-pi/contracts`.

## Workspace
```ts
interface Workspace { id; root; additionalRoots; revision; policy; capabilities }
```
One configured workspace per process (stdio); model cannot open/close arbitrary workspaces in V1.
The CLI starts `read-only` by default. `--security-profile trusted` is required
for workspace writes and LSP processes; `--allow-cwd` is a separate explicit
opt-in for using the process working directory as the workspace.

## File fingerprint (A11)
```ts
interface FileFingerprint { algorithm: "sha256"; digest; size }
```
Raw bytes are hashed **before** decoding. Short display anchor = uppercase hex prefix (12–16);
ambiguity never silently selects a version (`ERR_AMBIGUOUS_ANCHOR`).

`fs_read.offset` and `fs_read.max_bytes` are raw-byte values. The returned text
never cuts a UTF-8 or UTF-16 code unit sequence; `content_offset` identifies the
safe aligned start and `next_offset` continues from the next raw byte window.
The full-file hash and metadata are computed incrementally.

## Snapshot metadata (not a journal)
```ts
interface FileSnapshotRef { id; path; fingerprint; encoding; bom; newline; finalNewline; workspaceRevision }
```

## Capability
```ts
interface Capability<I,O> { name; risk: "read"|"write"|"network"|"exec"|"debug"|"secret"; execute(input, ctx) }
interface CapabilityContext { requestId; workspace; signal; deadline?; trace? }
```

## CapabilityResult
```ts
interface CapabilityResult<T> { schemaVersion:"1"; requestId; workspaceId; revision; data; warnings?; diagnostics?; artifacts?; backend?; degraded?; timing }
```

## Error taxonomy (22 codes)
`ERR_INVALID_ARGUMENT, ERR_WORKSPACE_NOT_FOUND, ERR_PATH_OUTSIDE_WORKSPACE, ERR_PATH_NOT_FOUND,
ERR_PERMISSION_DENIED, ERR_SECRET_PATH_DENIED, ERR_STALE_RESOURCE, ERR_AMBIGUOUS_ANCHOR,
ERR_FILE_BUSY, ERR_BINARY_FILE, ERR_UNSUPPORTED_ENCODING, ERR_ATOMIC_REPLACE_FAILED,
ERR_PARSE_FAILED, ERR_LSP_UNAVAILABLE, ERR_LSP_TIMEOUT, ERR_LSP_RESTART_EXHAUSTED,
ERR_NATIVE_UNAVAILABLE, ERR_NATIVE_FAILURE, ERR_ABORTED, ERR_OUTPUT_LIMIT,
ERR_UNSUPPORTED_CAPABILITY, ERR_PROTOCOL_COMPATIBILITY`.

## Encoding
Supported: UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM. Unsupported → `ERR_UNSUPPORTED_ENCODING`;
binary → `ERR_BINARY_FILE`. Mutations preserve encoding/BOM/newline/final-newline.

## V1 tool surface (13)
`workspace_info` · `fs_read, fs_stat, fs_write, fs_patch` · `search(mode=grep|glob)` ·
`ast_search(mode=text|query)` · `lsp_status, lsp_diagnostics, lsp_symbols, lsp_navigate` · `vcs_status, vcs_diff`.

An invalid Tree-Sitter query returns `ERR_PARSE_FAILED`; it does not silently
fall back to text matching. LSP navigation filters locations outside the
authorized workspace before exposing them as locations.
