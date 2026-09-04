# ADR-002: Local Daemon Boundary

## Context

The baseline configures one workspace per MCP stdio process. Its mutation mutex is held in process memory, so separate agent processes cannot share claims, cursors, intents, or durable work state. Source code and detailed code graph data also require a local privacy boundary.

## Alternatives

1. Keep one independent runtime per agent and rely on Git alone.
2. Centralize workspace state and source data in a hosted service.
3. Run one local daemon per logical project, with thin clients/adapters and a local transactional store.

## Decision

Choose alternative 3. One local `my-pi-daemon` is the coordination authority for one logical project. Multiple worktrees and agent sessions connect through an explicit IPC contract. SQLite WAL is the local persistence choice behind a store interface; it is not a distributed or network-filesystem database. Source content and detailed code-state observations remain local by default. MCP, CLI, and future protocol integrations are adapters and do not own persistence or coordination business logic.

The daemon boundary is additive and opt-in. Legacy capability mode continues without a daemon. Candidate self-hosting follows stable N-1 authority until the candidate passes promotion gates.

## Consequences

The local daemon adds lifecycle, IPC, migration, recovery, and version-skew work, but it provides the smallest authority capable of coordinating separate processes without centralizing source code. Enterprise control-plane functionality remains a separate later profile using its own authenticated service and transactional storage.

## Reversal criteria

Reconsider the daemon if qualified multi-process workloads show no reduction in stale coordination or integration repair, if local operational cost exceeds the value for the target users, or if the native host workflow provides equivalent results with lower complexity.
