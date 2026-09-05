export const FULL_SHA = /^[0-9a-f]{40}$/i;
export const ARTIFACT_SHA = /^[0-9a-f]{64}$/i;

export const REQUIRED_REMOTE_CHECKS = [
  "quality (windows-latest, node 24)",
  "quality (ubuntu-latest, node 22)",
  "quality (ubuntu-latest, node 24)",
  "quality (macos-latest, node 24)",
  "CodeQL Analysis (javascript-typescript)",
];
export const REMOTE_QUALIFICATION_PROVIDERS = ["github-check-runs", "github-actions-workflows", "github-public-job-pages"];

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

/**
 * Validate the runtime-generated proof that stable N-1 controlled the run.
 * This function is deliberately read-only and does not trust the boolean alone.
 */
export function validateStableBootstrapEvidence(evidence, { head, stateDigest } = {}) {
  const errors = [];
  const proof = evidence?.bootstrapProof ?? {};
  const bootstrapSha = typeof evidence?.bootstrapSha === "string" ? evidence.bootstrapSha.toLowerCase() : "";
  const candidateSha = typeof (head ?? evidence?.commit) === "string" ? (head ?? evidence.commit).toLowerCase() : "";

  add(errors, evidence?.bootstrapMode === "stable-n-minus-one-runtime", "PN9 stable bootstrap mode is invalid");
  add(errors, evidence?.status === "ACCEPTED", "PN9 stable bootstrap evidence must be ACCEPTED");
  add(errors, evidence?.promotionEligible === true, "PN9 stable bootstrap evidence must be promotion-eligible");
  add(errors, evidence?.stableNMinusOneVerified === true, "PN9 stable bootstrap verification is not true");
  add(errors, FULL_SHA.test(bootstrapSha) && FULL_SHA.test(candidateSha) && bootstrapSha !== candidateSha, "PN9 stable bootstrap SHA must be a distinct full commit");
  add(errors, FULL_SHA.test(evidence?.commit ?? "") && evidence.commit.toLowerCase() === candidateSha, "PN9 stable bootstrap candidate commit is stale");
  add(errors, evidence?.candidateSha === candidateSha && evidence?.candidateDirty === false, "PN9 stable bootstrap candidate state is dirty or stale");
  if (stateDigest !== undefined) add(errors, evidence?.candidateStateDigest === stateDigest, "PN9 stable bootstrap candidate state digest is stale");

  const remote = proof.remoteQualification ?? {};
  add(errors, REMOTE_QUALIFICATION_PROVIDERS.includes(remote.provider) && remote.status === "success" && remote.commit === bootstrapSha, "PN9 stable predecessor remote qualification is missing");
  const remoteChecks = new Map((remote.checks ?? []).map((check) => [check.name, check]));
  for (const name of REQUIRED_REMOTE_CHECKS) add(errors, remoteChecks.get(name)?.conclusion === "success", `PN9 stable predecessor check is not green: ${name}`);

  add(errors, proof.stableBuild?.passed === true, "PN9 stable predecessor build did not pass");
  add(errors, proof.candidateBuild?.passed === true, "PN9 candidate clean-checkout build did not pass");
  add(errors, proof.stableWorktree?.head === bootstrapSha && proof.stableWorktree?.clean === true, "PN9 stable worktree does not match a clean predecessor checkout");
  add(errors, proof.candidateWorktree?.head === candidateSha && proof.candidateWorktree?.cleanAtStart === true, "PN9 candidate worktree is not bound to the candidate at start");

  const artifacts = proof.stableWorktree?.artifact ?? {};
  add(errors, artifacts.sourceSha === bootstrapSha, "PN9 stable artifact source SHA does not match predecessor");
  add(errors, ARTIFACT_SHA.test(artifacts.daemon?.sha256 ?? "") && ARTIFACT_SHA.test(artifacts.mcp?.sha256 ?? ""), "PN9 stable runtime artifact digests are missing or malformed");
  add(errors, artifacts.daemon?.path === "apps/my-pi-daemon/dist/main.js" && artifacts.mcp?.path === "apps/my-pi-mcp/dist/main.js", "PN9 stable runtime artifact paths are invalid");

  const runtime = proof.runtime ?? {};
  add(errors, runtime.stableDaemonStarted === true && Number.isSafeInteger(runtime.stableDaemonPid) && runtime.stableDaemonPid > 0, "PN9 stable daemon was not observed running");
  add(errors, runtime.stableMcpConnected === true && typeof runtime.stableDaemonProjectId === "string", "PN9 stable MCP/daemon connection was not observed");
  add(errors, runtime.candidateDaemonStarted === false, "PN9 candidate daemon was used as an authority");

  const authority = proof.authority ?? {};
  add(errors, authority.stableRuntimeMediated === true && authority.candidateDaemonUsed === false, "PN9 authority mediation proof is invalid");
  add(errors, authority.mutationRuntimeSha === bootstrapSha && authority.evaluationRuntimeSha === bootstrapSha, "PN9 mutation/evaluation authority is not the stable predecessor");
  add(errors, Array.isArray(authority.mutationReceiptIds) && authority.mutationReceiptIds.length >= 2, "PN9 stable mutation receipt lineage is incomplete");
  add(errors, Array.isArray(authority.evaluationRunIds) && authority.evaluationRunIds.length >= 2, "PN9 stable evaluation lineage is incomplete");

  add(errors, Array.isArray(proof.legacyInspection?.tools) && proof.legacyInspection.tools.includes("fs_read"), "PN9 stable legacy inspection was not observed");
  return errors;
}
