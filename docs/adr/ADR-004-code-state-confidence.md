# ADR-004: Code-State Confidence

## Context

AST, LSP, VCS, and filesystem providers observe different portions of repository state. No provider is complete for every language or worktree, and stale observations can misroute work.

## Alternatives

1. Treat the graph as authoritative after indexing.
2. Use an LLM to decide relevance on every event.
3. Store provider, timestamp, worktree, fingerprint, and confidence metadata and use deterministic high-confidence edges for correctness-sensitive routing.

## Decision

Choose alternative 3. Code state is observed state. Exact or strong relationships may affect high-priority routing; medium or weak edges remain informational. Correctness-critical operations revalidate current resources rather than trusting a stale graph record.

## Consequences

Routing can degrade transparently when a provider is unavailable. The system must explain impact paths and measure false positives, misses, latency, and graph freshness.

## Reversal criteria

Reconsider the graph strategy if maintenance cost dominates task execution or if representative benchmarks show no value over explicit work dependencies and a simple task board.
