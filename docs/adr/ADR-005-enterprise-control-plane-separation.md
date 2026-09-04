# ADR-005: Enterprise Control-Plane Separation

## Context

Organizations may need identity, policy distribution, audit retention, fleet health, and evaluation governance. Those needs do not require moving source code or local workspace authority into a central service.

## Alternatives

1. Make a hosted control plane mandatory for all local usage.
2. Put enterprise policy and source operations directly in the local capability providers.
3. Keep a local-first node and add an optional authenticated control plane for organization metadata and governance.

## Decision

Choose alternative 3. Enterprise services receive only the metadata permitted by policy. Local nodes remain source-workspace authorities. Tenant isolation, authenticated principals, policy decisions, audit, retention, and evaluation catalog trust belong to the enterprise profile; local filesystem/VCS behavior does not.

## Consequences

Offline local development remains possible, but policy synchronization, TTLs, identity, tenant isolation, and server-side recovery require qualification before enterprise claims.

## Reversal criteria

Reconsider the separation only if a qualified product requirement proves that central source authority is necessary and the resulting privacy, latency, availability, and migration trade-offs are accepted explicitly.
