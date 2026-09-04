# ADR-003: Coordination Event Model

## Context

Multiple agents need a reconstructable project history without turning arbitrary conversation text into durable state. Coordination commands also need a monotonic cursor and an idempotent retry boundary.

## Alternatives

1. Store only mutable snapshots.
2. Persist an unbounded chat transcript.
3. Persist an append-only, per-project event sequence with typed payloads and materialized projections.

## Decision

Choose alternative 3. Every event carries a schema version, project, sequence, event ID, timestamp, actor, optional correlation/causation references, and typed payload. Projection updates occur in the same transaction as the event where feasible. The log is an operational record, not cryptographic non-repudiation.

## Consequences

Replay, cursors, audit inspection, and deterministic recovery become possible. Payloads must remain bounded and schema-versioned; retention must be explicit.

## Reversal criteria

Reconsider the event model if storage growth or replay cost cannot remain bounded under representative coordination workloads, or if event semantics cannot be kept stable across migrations.
