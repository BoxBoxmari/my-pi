import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_REMOTE_CHECKS, validateStableBootstrapEvidence } from "../../scripts/stable-bootstrap-contract.mjs";

const HEAD = "b".repeat(40);
const BOOTSTRAP = "a".repeat(40);
const STATE_DIGEST = "state-digest";

function validEvidence() {
  return {
    bootstrapMode: "stable-n-minus-one-runtime",
    status: "ACCEPTED",
    promotionEligible: true,
    stableNMinusOneVerified: true,
    bootstrapSha: BOOTSTRAP,
    commit: HEAD,
    candidateSha: HEAD,
    candidateDirty: false,
    candidateStateDigest: STATE_DIGEST,
    bootstrapProof: {
      remoteQualification: {
        provider: "github-check-runs",
        status: "success",
        commit: BOOTSTRAP,
        checks: REQUIRED_REMOTE_CHECKS.map((name) => ({ name, conclusion: "success" })),
      },
      stableBuild: { passed: true },
      candidateBuild: { passed: true },
      stableWorktree: {
        head: BOOTSTRAP,
        clean: true,
        artifact: {
          sourceSha: BOOTSTRAP,
          daemon: { path: "apps/my-pi-daemon/dist/main.js", sha256: "1".repeat(64) },
          mcp: { path: "apps/my-pi-mcp/dist/main.js", sha256: "2".repeat(64) },
        },
      },
      candidateWorktree: { head: HEAD, cleanAtStart: true },
      runtime: { stableDaemonStarted: true, stableDaemonPid: 1234, stableDaemonProjectId: "project_test", stableMcpConnected: true, candidateDaemonStarted: false },
      authority: { stableRuntimeMediated: true, mutationRuntimeSha: BOOTSTRAP, evaluationRuntimeSha: BOOTSTRAP, mutationReceiptIds: ["receipt_1", "receipt_2"], evaluationRunIds: ["eval_1", "eval_2"], candidateDaemonUsed: false },
      legacyInspection: { tools: ["workspace_info", "fs_read"] },
    },
  };
}

test("stable bootstrap rejects a bootstrap SHA equal to candidate", () => {
  const evidence = validEvidence();
  evidence.bootstrapSha = HEAD;
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("distinct full commit")));
});

test("stable bootstrap rejects an artifact built from the wrong predecessor", () => {
  const evidence = validEvidence();
  evidence.bootstrapProof.stableWorktree.artifact.sourceSha = HEAD;
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("artifact source SHA")));
});

test("stable bootstrap rejects an unavailable predecessor build", () => {
  const evidence = validEvidence();
  evidence.bootstrapProof.stableBuild.passed = false;
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("predecessor build")));
});

test("stable bootstrap rejects a dirty candidate", () => {
  const evidence = validEvidence();
  evidence.candidateDirty = true;
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("candidate state")));
});

test("stable bootstrap rejects stale candidate evidence", () => {
  const evidence = validEvidence();
  evidence.candidateStateDigest = "stale";
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("state digest")));
});

test("stable bootstrap rejects evidence when the N-1 runtime was not used", () => {
  const evidence = validEvidence();
  evidence.bootstrapProof.runtime.candidateDaemonStarted = true;
  evidence.bootstrapProof.authority.candidateDaemonUsed = true;
  assert.ok(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }).some((error) => error.includes("candidate daemon")));
});

test("stable bootstrap accepts workflow and job API qualification provenance", () => {
  const evidence = validEvidence();
  evidence.bootstrapProof.remoteQualification.provider = "github-actions-workflows";
  assert.deepEqual(validateStableBootstrapEvidence(evidence, { head: HEAD, stateDigest: STATE_DIGEST }), []);
});
