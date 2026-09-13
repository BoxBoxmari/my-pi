import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyObservedAggregate } from "../../scripts/verify-observed-evidence-v2.mjs";

function report(overrides = {}) {
  return {
    schemaVersion: "1",
    recordType: "observed-evidence-aggregate-v2",
    status: "WITHHELD",
    promotionEligible: false,
    sample: {
      minQualifiedPerHypothesis: 3,
      byHypothesis: {
        PN6: { registered: 1, qualified: 1 },
        PN8: { registered: 1, qualified: 0 },
      },
    },
    pairs: [{ taskId: "OT-011", primaryHypothesis: "PN6", qualified: true, validPair: true, runIds: ["run-control", "run-treatment"], evaluatorRunId: "eval-independent" }],
    ...overrides,
  };
}

test("aggregate verifier accepts a valid withheld candidate", () => {
  const verification = verifyObservedAggregate(report());
  assert.deepEqual(verification, { ok: true, errors: [], admission: "WITHHELD", promotionEligible: false });
});

test("aggregate verifier rejects self-promotion and non-independent qualification", () => {
  const verification = verifyObservedAggregate(report({
    promotionEligible: true,
    pairs: [{ taskId: "OT-011", primaryHypothesis: "PN6", qualified: true, validPair: false, runIds: ["run-control", "run-control"], evaluatorRunId: "run-control" }],
  }));
  assert.equal(verification.ok, false);
  assert.match(verification.errors.join("\n"), /self-promote/);
  assert.match(verification.errors.join("\n"), /validPair/);
  assert.match(verification.errors.join("\n"), /duplicate arm run ids/);
});
