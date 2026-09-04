import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("PN6 controlled routing corpus compares all five coordination arms", () => {
  const output = execFileSync(process.execPath, ["benchmarks/impact-routing-arms.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.evidenceKind, "controlled_replay");
  assert.equal(report.cases, 5);
  assert.equal(report.arms.fullImpactRouting.recall, 1);
  assert.ok(report.arms.fullImpactRouting.averageRepairIterations < report.arms.taskBoardOnly.averageRepairIterations);
  assert.ok(report.arms.fullImpactRouting.staleContractMistakes < report.arms.taskBoardOnly.staleContractMistakes);
});
