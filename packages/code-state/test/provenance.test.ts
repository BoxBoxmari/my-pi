import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChangeReceipt, ResourceVersion } from "@my-pi/contracts";
import { fingerprintBytes } from "@my-pi/contracts";
import { classifyMutationObservation, ProvenanceReconciler } from "@my-pi/code-state";

const projectId = "project-provenance" as never;
const worktreeId = "worktree-provenance" as never;

function version(path: string, content: string): ResourceVersion {
  return { path, fingerprint: fingerprintBytes(new TextEncoder().encode(content)), absent: false };
}

function receipt(input: ResourceVersion, output: ResourceVersion, overrides: Partial<ChangeReceipt> = {}): ChangeReceipt {
  return {
    id: "receipt-provenance" as never,
    proposalId: "proposal-provenance" as never,
    projectId,
    worktreeId,
    status: "APPLIED",
    inputVersions: [input],
    outputVersions: [output],
    resources: [output],
    verification: { verified: true, digest: "output" },
    publishedAt: "2026-09-13T00:01:00.000Z",
    completedAt: "2026-09-13T00:01:00.000Z",
    receiptDigest: "receipt-digest",
    ...overrides,
  };
}

test("B0/B1 golden: verified my-pi output is managed", () => {
  const before = version("src/a.ts", "before");
  const after = version("src/a.ts", "after");
  const result = classifyMutationObservation({
    observation: { projectId, worktreeId, path: "src/a.ts", previous: before, current: after, changed: true, observedAt: "2026-09-13T00:02:00.000Z" },
    receipts: [receipt(before, after)],
    verifyReceipt: () => true,
  });
  assert.equal(result.status, "managed");
  assert.deepEqual(result.reasonCodes, ["verified_receipt_output"]);
});

test("B0/B1 bypass: direct editor mutation is unmanaged", () => {
  const before = version("src/a.ts", "before");
  const receiptOutput = version("src/a.ts", "after");
  const external = version("src/a.ts", "external");
  const result = classifyMutationObservation({
    observation: { projectId, worktreeId, path: "src/a.ts", previous: receiptOutput, current: external, changed: true, observedAt: "2026-09-13T00:03:00.000Z" },
    receipts: [receipt(before, receiptOutput)],
    verifyReceipt: () => true,
  });
  assert.equal(result.status, "unmanaged");
  assert.deepEqual(result.reasonCodes, ["receipt_output_mismatch"]);
});

test("B1 stale lineage: output bytes do not override an incompatible ancestor", () => {
  const expectedInput = version("src/a.ts", "expected-before");
  const observedPrevious = version("src/a.ts", "other-before");
  const after = version("src/a.ts", "after");
  const result = classifyMutationObservation({
    observation: { projectId, worktreeId, path: "src/a.ts", previous: observedPrevious, current: after, changed: true, observedAt: "2026-09-13T00:04:00.000Z" },
    receipts: [receipt(expectedInput, after)],
    verifyReceipt: () => true,
  });
  assert.equal(result.status, "stale_lineage");
  assert.deepEqual(result.reasonCodes, ["input_lineage_mismatch"]);
});

test("B1 unknown: an invalid receipt never grants managed status", () => {
  const before = version("src/a.ts", "before");
  const after = version("src/a.ts", "after");
  const result = classifyMutationObservation({
    observation: { projectId, worktreeId, path: "src/a.ts", previous: before, current: after, changed: true, observedAt: "2026-09-13T00:05:00.000Z" },
    receipts: [receipt(before, after, { receiptDigest: undefined })],
    verifyReceipt: () => false,
  });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.reasonCodes, ["receipt_invalid"]);
});

test("B1 exempt: configured evidence paths are never treated as source mutations", () => {
  const result = classifyMutationObservation({
    observation: { projectId, worktreeId, path: ".my-pi/provenance/report.json", current: { path: ".my-pi/provenance/report.json", absent: false, fingerprint: fingerprintBytes(new TextEncoder().encode("report")) }, changed: true, observedAt: "2026-09-13T00:06:00.000Z" },
    receipts: [],
    exemptPaths: [".my-pi/provenance/**"],
    verifyReceipt: () => true,
  });
  assert.equal(result.status, "exempt");
});

test("B1 bypass: writing the same bytes again does not fabricate a second transition", () => {
  const before = version("src/a.ts", "before");
  const after = version("src/a.ts", "after");
  const reconciler = new ProvenanceReconciler({ verifyReceipt: () => true });
  reconciler.registerReceipt(receipt(before, after));
  const first = reconciler.observe({ projectId, worktreeId, path: "src/a.ts", current: before, observedAt: "2026-09-13T00:07:00.000Z" });
  const second = reconciler.observe({ projectId, worktreeId, path: "src/a.ts", current: after, observedAt: "2026-09-13T00:08:00.000Z" });
  const duplicate = reconciler.observe({ projectId, worktreeId, path: "src/a.ts", current: after, observedAt: "2026-09-13T00:09:00.000Z" });
  assert.equal(first.status, "unmanaged");
  assert.equal(second.status, "managed");
  assert.equal(duplicate.status, "unknown");
  assert.deepEqual(duplicate.reasonCodes, ["unchanged_fingerprint"]);
});

test("B1 provenance report is read-only, latest-per-path, and bounded", () => {
  const before = version("src/a.ts", "before");
  const after = version("src/a.ts", "after");
  const other = version("src/b.ts", "other");
  const reconciler = new ProvenanceReconciler();
  reconciler.observe({ projectId, worktreeId, path: "src/a.ts", current: before, observedAt: "2026-09-13T00:10:00.000Z" });
  reconciler.observe({ projectId, worktreeId, path: "src/a.ts", current: after, observedAt: "2026-09-13T00:11:00.000Z" });
  reconciler.observe({ projectId, worktreeId, path: "src/b.ts", current: other, observedAt: "2026-09-13T00:12:00.000Z" });
  const report = reconciler.report({ projectId, worktreeId, maxResults: 1 });
  assert.equal(report.schemaVersion, "my-pi/provenance-report/v1");
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]?.path, "src/a.ts");
  assert.equal(report.truncated, true);
  assert.equal(report.cursor?.next, "1");
  assert.equal(reconciler.report({ projectId, worktreeId, path: "missing.ts" }).degraded?.provider, "code-state");
});
