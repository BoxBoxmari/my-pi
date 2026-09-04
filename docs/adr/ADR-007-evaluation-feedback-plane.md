# ADR-007: Evidence-Bound Evaluation and Feedback

## Context

Agent completion messages and ordinary logs do not prove that a precise work item reached an acceptable software state. Automated retry can amplify weak or stale criteria if acceptance is not tied to exact state.

## Alternatives

1. Treat agent completion as acceptance.
2. Use a scalar reward and automatically spawn retries.
3. Record versioned evaluation specs, exact target-state evidence, deterministic acceptance, structured feedback, and bounded retry state while leaving execution decisions to an external orchestrator or authorized human.

## Decision

Choose alternative 3. Missing or stale evidence is never implicit success. Evaluator errors remain distinct from implementation failures. Worker agents cannot weaken authoritative criteria, and model-supplied arbitrary shell is not an evaluator definition.

## Consequences

The system can explain why work is rejected, inconclusive, or review-required. It must retain evidence according to classification and prove measurable repair value before expanding feedback/retry automation.

## Reversal criteria

Keep evaluation as evidence ingestion only if structured feedback does not improve seeded-defect repair outcomes over ordinary CI/test-log handoff, or if safe exact-state binding cannot be demonstrated.
