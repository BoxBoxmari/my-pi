const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Evaluate the immutable parts of candidate-baseline admission. Git supplies
 * ancestorExitCode; the helper keeps equality, ancestry, cleanliness, and
 * evidence binding explicit and independently testable.
 */
export function baselineAssessment({ baseline, head, ancestorExitCode, candidateDirty, evidenceCommit }) {
  const validBaseline = FULL_SHA.test(baseline ?? "");
  const validHead = FULL_SHA.test(head ?? "");
  return {
    sha: validBaseline ? baseline : null,
    matchesHead: validBaseline && validHead && baseline.toLowerCase() === head.toLowerCase(),
    isAncestor: validBaseline && validHead && ancestorExitCode === 0,
    candidateClean: candidateDirty === false,
    ...(evidenceCommit === undefined ? {} : { evidenceBound: FULL_SHA.test(evidenceCommit) && validHead && evidenceCommit.toLowerCase() === head.toLowerCase() }),
  };
}
