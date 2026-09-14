import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineAssessment } from "../../scripts/baseline-ancestry.mjs";
import { isGeneratedArtifact } from "../../scripts/candidate-state.mjs";

const BASELINE = "1".repeat(40);
const HEAD = "2".repeat(40);

test("Production Next baseline admission accepts the baseline commit itself", () => {
  const result = baselineAssessment({ baseline: BASELINE, head: BASELINE, ancestorExitCode: 0, candidateDirty: false, evidenceCommit: BASELINE });
  assert.equal(result.matchesHead, true);
  assert.equal(result.isAncestor, true);
  assert.equal(result.candidateClean, true);
  assert.equal(result.evidenceBound, true);
});

test("Production Next baseline admission accepts a clean descendant", () => {
  const result = baselineAssessment({ baseline: BASELINE, head: HEAD, ancestorExitCode: 0, candidateDirty: false, evidenceCommit: HEAD });
  assert.equal(result.matchesHead, false);
  assert.equal(result.isAncestor, true);
  assert.equal(result.candidateClean, true);
  assert.equal(result.evidenceBound, true);
});

test("Production Next baseline admission rejects an unrelated candidate", () => {
  const result = baselineAssessment({ baseline: BASELINE, head: HEAD, ancestorExitCode: 1, candidateDirty: false, evidenceCommit: HEAD });
  assert.equal(result.isAncestor, false);
});

test("Production Next baseline admission exposes a dirty candidate", () => {
  const result = baselineAssessment({ baseline: BASELINE, head: HEAD, ancestorExitCode: 0, candidateDirty: true, evidenceCommit: HEAD });
  assert.equal(result.isAncestor, true);
  assert.equal(result.candidateClean, false);
});

test("Production Next baseline admission rejects evidence bound to the wrong candidate", () => {
  const result = baselineAssessment({ baseline: BASELINE, head: HEAD, ancestorExitCode: 0, candidateDirty: false, evidenceCommit: BASELINE });
  assert.equal(result.isAncestor, true);
  assert.equal(result.evidenceBound, false);
});

test("candidate state excludes generated protocol evidence without excluding source", () => {
  assert.equal(isGeneratedArtifact("docs/protocol-evidence.json"), true);
  assert.equal(isGeneratedArtifact("results.sarif"), true);
  assert.equal(isGeneratedArtifact("evidence/PN9.json"), true);
  assert.equal(isGeneratedArtifact("evidence/track-a-integrity-gates-2026-09-15.json"), true);
  assert.equal(isGeneratedArtifact("evidence/track-a-xh-verify-2026-09-15.json"), true);
  assert.equal(isGeneratedArtifact("evidence/track-a-real-pn6-OT-061.json"), true);
  assert.equal(isGeneratedArtifact("evidence/track-a-pn8-live-repair-OT-071.json"), true);
  assert.equal(isGeneratedArtifact("dogfood/observed-tasks/OT-061.result.json"), true);
  assert.equal(isGeneratedArtifact("dogfood/observed-tasks/OT-071.paired-manifest.json"), true);
  assert.equal(isGeneratedArtifact("dist-release/release-manifest.json"), true);
  assert.equal(isGeneratedArtifact("dist-release/my-pi-workspace-0.1.0-alpha.2.tgz"), true);
  assert.equal(isGeneratedArtifact("packages/contracts/src/ids.ts"), false);
});
