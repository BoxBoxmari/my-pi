# Replacing candidate evidence with observed evidence

The PN6, PN8, PN9, and PN12 documents in `evidence/` are candidate
qualification records. They are intentionally not promotion evidence: controlled
fixture labels and a candidate-built daemon do not establish user value or a
stable bootstrap boundary. PN9 now exercises server-registered evaluator
execution and receipt-verified target state, but it still uses the current
candidate build as its bootstrap and therefore does not prove stable N-1.

An authorized release review may replace a document only after rerunning the
same profile against a clean candidate commit. The envelope must then use
`status: ACCEPTED`, `promotionEligible: true`, the exact candidate `commit`,
`candidateDirty: false`, and the matching `candidateStateDigest`.

PN6 and PN8 additionally require `evidenceKind: observed_replay`, an explicit
`observationSource`, and non-empty `independentRunIds`. Those identifiers must
refer to real or independently replayable engineering work, not only the local
fixture runner. PN6 must contain observed downstream correctness/rework
outcomes; PN8 must contain observed ordinary-log and structured-feedback repair
outcomes with regression protection.
PN9 must set `stableNMinusOneVerified: true`, use a distinct stable `bootstrapSha`,
and retain the real bounded source-change replay. PN12 may remain local, but its
untested fault list must not be removed without corresponding evidence.

Run `node scripts/verify-production-next-promotion.mjs` before creating the
extended manifest. The verifier is read-only and returns `WITHHELD` until all
four envelopes satisfy these conditions.
