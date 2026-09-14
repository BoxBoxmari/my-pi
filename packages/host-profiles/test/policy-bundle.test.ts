import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_PROFILES, assessHostBypass, renderPolicyBundle, REQUIRED_BYPASS_VECTORS } from "@my-pi/host-profiles";

const profile = REQUIRED_PROFILES.find((item) => item.id === "opencode-current-local")!;

test("strict candidate policy bundle is explicit about residual paths before bypass evidence", () => {
  const bundle = renderPolicyBundle(profile, { command: "my-pi-mcp", strictCandidate: true });
  assert.equal(bundle.maturity, "strict-capable");
  assert.equal(bundle.certification, "candidate");
  assert.ok(bundle.knownUnenforcedPaths.includes("bypass-suite-not-run"));
  assert.equal(bundle.enforcement.directGitPatch, "admission-only");
});

test("strict certification requires every seeded bypass vector and no residual path", () => {
  const incomplete = assessHostBypass([{ vector: "native-edit", blocked: true }]);
  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.missingVectors.includes("direct-git-patch"));
  const results = REQUIRED_BYPASS_VECTORS.map((vector) => ({ vector, blocked: true, evidenceRef: `seeded:${vector}` }));
  const complete = assessHostBypass(results);
  assert.deepEqual(complete, { passed: true, missingVectors: [], residualPaths: [] });
  const bundle = renderPolicyBundle(profile, { command: "my-pi-mcp", strictCandidate: true, knownUnenforcedPaths: [], bypassResults: results });
  assert.equal(bundle.certification, "strict-certified");
});
