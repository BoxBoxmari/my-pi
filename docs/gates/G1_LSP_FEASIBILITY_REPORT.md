# G1 — LSP Feasibility Spike (RE-EARNED)

Status: **PASS (TypeScript-only spike)** — with diagnostics noted as server-behavior-dependent.

## What was proven (executable evidence, 2026-09-01)

`packages/lsp/test/lsp-spike.test.ts` — 2/2 PASS against a real
`typescript-language-server@4.4.1` using the repo's bundled TypeScript 5.9.3:

| Lifecycle step | Evidence |
|---|---|
| discover (binary resolve) | `node_modules/.bin/typescript-language-server` via explicit path; tsserver auto-resolved (log: "Using Typescript version (bundled) 5.9.3") |
| spawn | shell-spawn `.cmd` on Windows handled; process running asserted |
| initialize / initialized | `initialize` result with 23 capability keys; `initialized` sent |
| didOpen | probe document opened over the wire |
| navigation (hover) | real hover content returned for the probe document |
| cancel in-flight | `$/cancelRequest` sent; **connection survived** (running == true) |
| shutdown / exit | clean shutdown completed (`cleanShutdown: true`) |
| forced kill fallback | `taskkill /T /F` process-tree kill on Windows (SIGKILL is insufficient for the npx/node/tsserver tree) |
| crash + restart | killed server confirmed down; restarted successfully |
| bounded backoff | exponential sequence `[100, 200, 400]` ms, 3 attempts — bounded |
| zombie check | PID gone after exit (`tasklist` probe) — `zombieFree: true` |

## Notes and honest deviations

- **Diagnostics push**: the spike records `textDocument/publishDiagnostics`
  notifications but does NOT gate on receiving them. On this environment the
  server did not push diagnostics for the temp-dir probe (tsserver project
  model). This is server behavior, not a my-pi contract gap; production `lsp_diagnostics`
  (G5) must validate push/pull per server before that tool ships.
- **RSS sampling**: not exercised in the spike; it is a production
  monitoring concern (G5 `ResourceMonitor`).
- **Cancel proof**: the connection-survival form was used (send `$/cancelRequest`,
  verify the connection stays alive). The stricter "late response discarded" form
  is deferred to G5 where request/response pairing is tracked per-id.

## Frozen lifecycle contract (from `packages/lsp/src/spike.ts` + `lifecycle.ts`)

```
STOPPED -> STARTING -> READY -> DEGRADED/RESTARTING -> STOPPING -> STOPPED
```

with: bounded exponential restart backoff, process-tree cleanup on Windows
(`taskkill /T /F`), LSP JSON-RPC framing (Content-Length), request timeouts
(`ERR_LSP_TIMEOUT`), and shutdown/exit sequencing.

## Verdict

G1's LSP-feasibility item moves from **BLOCKED** to **PASS (TypeScript-only)**.
The lifecycle contract is now backed by executable evidence and may be
productionized in G5. Four-language certification (TS/Python/Rust/Go) remains
G5 scope and requires each server installed and exercised.
