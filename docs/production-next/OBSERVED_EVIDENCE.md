# Replacing candidate evidence with observed evidence

PN6, PN8, and PN12 in `evidence/` remain candidate qualification records and
are intentionally not promotion evidence: controlled fixture labels and local
fault scenarios do not establish independent product outcomes. PN9 has two
execution profiles: the candidate-current-build replay remains diagnostic,
while `scripts/dogfood-stable-bootstrap.mjs` builds and runs a distinct stable
N-1 runtime before producing stable-bootstrap evidence. The current PN9 record
for candidate `0227f5c` is `ACCEPTED` and uses predecessor `fe671ae`; this does
not make the overall promotion gate pass while PN6/PN8/PN12 remain withheld.

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
and retain the real bounded source-change replay. The read-only verifier checks
the predecessor build, remote qualification, runtime identity, authority path,
and receipt/evaluation lineage rather than trusting the flag alone. PN12 may remain local, but its
untested fault list must not be removed without corresponding evidence.

Run `node scripts/verify-production-next-promotion.mjs` before creating the
extended manifest. The verifier is read-only and returns `WITHHELD` until all
four envelopes satisfy these conditions.
