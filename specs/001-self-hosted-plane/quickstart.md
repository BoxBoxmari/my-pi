# Quickstart Validation Guide

This guide validates the current local increment. It deliberately distinguishes implementation
health from promotion evidence.

## Prerequisites

- Windows PowerShell in `C:\Users\Admin\Downloads\Compressed\my-pi`.
- Node.js, pnpm, Go, `specify`, `agt`, `xh`, CodeGraph, and the repository dependencies installed.
- The my-pi MCP server built at `apps/my-pi-mcp/dist/main.js`.
- No assumption that dirty-worktree output is candidate-bound promotion evidence.

## Spec Kit and baseline

```powershell
specify check
& .\.specify\scripts\powershell\check-prerequisites.ps1 -Json
codegraph sync .
codegraph status .
```

Expected: Spec Kit and Codex are available; the feature artifacts resolve; CodeGraph reports an
up-to-date index. Read `.specify/memory/constitution.md` and the four source plan files before
changing implementation scope.

## Build and regression gates

```powershell
pnpm test:fast
pnpm build
pnpm typecheck
pnpm test:release
pnpm verify
```

Expected: targeted tests, build, typecheck, release tests, and the repository verify profile pass.
The verify output may still report candidate/withheld Production Next evidence; that is expected
until real qualified observations exist.

## Official my-pi MCP probe

Launch the MCP server through the official MCP client, then record:

1. `tools/list` names and schemas with visuals disabled;
2. `workspace_info` and `vcs_status`;
3. read-only `lsp_diagnostics` on the changed TypeScript files;
4. repeat the catalog with `--visuals` and record progressive degradation;
5. use `fs_read` to read back generated evidence and its content hash.

The default catalog must remain exactly 13 tools. Use the tool responses as evidence, not a prose
claim that the server was started.

## Track A measurement

```powershell
node scripts/validate-observed-task-v2.mjs --task <task.json> --result <control.result.json> --result <treatment.result.json>
pnpm dogfood:observed-v2 --task <task.json>
pnpm aggregate:observed-v2
pnpm verify:observed-v2
```

Run only pre-registered real tasks for promotion evidence. Verify that the task definition commit
precedes both runs, worktrees and sessions are distinct, and the evaluator is independent. A legacy
v1 record or an instrumentation-only run must remain invalid/withheld.

## Track B admission

```powershell
node scripts/verify-my-pi-admission.mjs --base <base-sha> --head <head-sha> --report-only
node scripts/seal-my-pi-admission.mjs --base <base-sha> --head <head-sha>
```

Use a clean, authorized candidate for sealing. Seed a direct external source edit and confirm
report/strict mode identifies it as unmanaged or review-required. Verify tamper, wrong-key, stale
head, extra-path, and missing-attestation cases. Do not place private signing material in the
workspace.

## Track C graph and portal

Run the focused graph, coordination cancellation, portal, and MCP integration tests. Start the
portal with its loopback configuration and verify:

- four graph kinds use the same bounded snapshot contract;
- expansion respects depth/node/edge/attribute limits;
- trace returns only a deterministic directed path or the bounded endpoints with `found: false`;
- evidence references and truncation/degraded state are visible;
- invalid origin/host/token and non-loopback binding are rejected;
- visuals-disabled MCP startup still exposes the stable catalog.

## Final read-only admission

```powershell
agt integrity --root .
agt lint-policy .agt/policy.json
xh doctor --root . --format json
xh verify --card .x-harness/self-hosted-track-a-completion-card.yaml `
  --profile light-local --tier deep --json --worktree-aware --diff-check --strict-withheld-reason
```

Only an x-harness result containing both `admission.outcome: success` and
`acceptance_status: accepted` is accepted. Otherwise report the exact withheld/blocked reason and
the next owner/action. Do not self-admit from a passing `pnpm verify` alone.
