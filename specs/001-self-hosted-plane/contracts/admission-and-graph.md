# Admission and Graph Read Contracts

## Local admission report

The report is read-only and returns one decision plus path-level findings:

```json
{
  "decision": "allowed|rejected|review_required",
  "base": "<sha>",
  "head": "<sha>",
  "subjectDigest": "sha256:<digest>",
  "paths": [
    {
      "path": "relative/path.ts",
      "decision": "managed|unmanaged|stale_lineage|unknown|exempt",
      "reasonCodes": ["<code>"],
      "receiptDigest": "sha256:<digest>"
    }
  ]
}
```

Report mode does not write source, provenance, attestations, or Git state. Strict mode rejects
uncovered source paths and invalid proof. The provenance metadata directory is excluded from the
subject only by the explicit policy rule.

## Graph snapshot and expansion

`graph_snapshot` accepts a project/worktree scope, graph kind, optional subject, and explicit
`maxNodes`, `maxEdges`, and `maxAttributeBytes` bounds. `graph_expand` adds a node ID and bounded
depth. The daemon returns a `GraphSnapshot` with deterministic nodes/edges, evidence references,
applied bounds, truncation/cursor information, and a degraded provider reason when authoritative
data is unavailable.

`graph_trace` accepts `fromNodeId`, `toNodeId`, and a bounded `maxDepth` from the same authorized
scope. It returns `my-pi/graph-trace/v1` with the deterministic directed path when one is found,
the selected endpoints when it is not, `found`, `truncated`, and the applied bounds. It never
invents an edge and remains read-only.

The client MUST propagate cancellation and MUST not permit generic `eval` or `execute` calls.
Project/worktree authorization, frame limits, output limits, and bounded retries apply before the
portal or MCP Apps surface receives data.

## Portal boundary

The local portal is loopback-only by default and requires a session token. Requests with an
invalid Host/Origin/token, arbitrary filesystem/database parameters, or non-loopback bind targets
are rejected. The browser view can only read graph snapshots, bounded expansions, and bounded
traces; no mutation operation is exposed by the portal contract.
