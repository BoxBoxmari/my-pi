# ADR-001: Production Next Direction

## Context

The baseline at `273ed28947a94a2495b10721f725447ea769994d` is a useful, security-first MCP capability runtime with 13 public tools. It does not yet provide shared work state for multiple coding agents, and its current product identity should not be replaced by an untested platform thesis.

## Alternatives

1. Continue expanding the 13-tool catalog as a general coding-tool suite.
2. Replace the runtime with a generic agent orchestration or chat platform.
3. Evolve the runtime into a local-first software coordination state engine while preserving the existing capability layer.

## Decision

Choose alternative 3. Preserve the legacy capability contracts and reuse their filesystem, search, AST, LSP, VCS, policy, artifact, cancellation, and observability implementations as providers or sensors. Add coordination only through staged gates: domain contracts, durable local state, daemon-backed coordination, code state, impact/context routing, change integrity, evidence-bound evaluation, and then dogfood and enterprise extensions.

my-pi remains host-neutral. It does not select models, manage prompts, create generic chat, or spawn replacement agents. Product value is not assumed: PN6, PN8, and PN9 are empirical gates, not documentation milestones.

## Consequences

The repository carries compatibility cost, but existing users retain a stable entry point. New packages can evolve behind protocol-neutral contracts. The team must collect representative multi-agent workload evidence before broad enterprise investment.

## Reversal criteria

Stop or narrow the direction if intent-aware impact routing does not materially improve integration correctness or repair effort over worktrees plus a simple task board, or if coordination noise and maintenance cost dominate the benefit.
