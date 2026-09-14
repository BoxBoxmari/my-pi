# Observed Evidence v2 Contract

## Inputs

The validator accepts one immutable task definition and exactly two arm results. The task must
declare `taskId`, `hypothesis`, `baseSha`, arm definitions, one primary variable, acceptance
criteria, predeclared tests, metrics, adjudication, and contamination controls. Results must
reference the task and include unique `runId`, `sessionId`, arm, base, timestamps, bounded test
outcomes, and independent adjudication.

## Eligibility rules

An observation is eligible only when all of the following are true:

1. The task definition commit, declared base commit, and separate registration-receipt commit must resolve in Git; each commit timestamp must precede both run starts.
2. The receipt commit must be an ancestor of the candidate HEAD, the task-definition commit must be an ancestor of the receipt commit, and the committed task/receipt blobs must match the submitted task identity.
3. Both arms use the same declared base and distinct worktrees and sessions.
3. The primary variable is the only intended difference.
4. All required tests and adjudication records are present.
5. No contamination, task drift, duplicate identity, or forbidden artifact is detected.

Invalid records remain available for audit but are excluded from aggregate counts. The aggregator
must report the reason rather than silently dropping a record.

## Aggregate output

The derivation output contains:

```json
{
  "schemaVersion": "my-pi/observed-evidence-v2/aggregate",
  "candidateSha": "<exact candidate>",
  "status": "WITHHELD|CANDIDATE",
  "promotionEligible": false,
  "sample": {"minQualifiedPerHypothesis": 3},
  "hypotheses": {
    "PN6": {"totalPairs": 0, "qualifiedPairs": 0, "targetMet": false},
    "PN8": {"totalPairs": 0, "qualifiedPairs": 0, "targetMet": false}
  },
  "reasons": ["<machine-readable reason>"],
  "sources": ["<task/result IDs>"]
}
```

The aggregate is a candidate evidence artifact. It never overrides the existing Production Next
promotion verifier and must be regenerated after a candidate commit changes.
