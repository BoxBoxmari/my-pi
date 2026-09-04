# ADR-006: Stable N-1 Self-Host Bootstrap

## Context

Using an evolving candidate to build and promote its own source creates circular trust. A failure in coordination, mutation admission, or evaluation could make the evidence irreproducible.

## Alternatives

1. Let the current candidate become its own sole authority immediately.
2. Prohibit self-hosting entirely.
3. Use stable N-1 for mutation and promotion-critical evaluation while candidate N progresses through shadow and canary stages.

## Decision

Choose alternative 3. Candidate N may observe and coordinate in shadow mode, but stable N-1 remains the mutation and promotion authority until compatibility, impact, evaluation, security, migration, and release gates pass.

## Consequences

Dogfood evidence is slower to collect but remains attributable and recoverable. Protected paths stay on the stable or human-reviewed route.

## Reversal criteria

Reconsider only after an independently verified promotion gate demonstrates that candidate behavior is compatible, reproducible, and safe for the qualified workload.
