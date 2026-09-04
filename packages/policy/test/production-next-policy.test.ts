import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalBindingDigest,
  BoundedAuditSink,
  BuiltinPolicyDecisionPoint,
  makeApprovalReceipt,
  isTrustedPrincipal,
  verifyApprovalReceipt,
} from "@my-pi/policy";

const principal = { id: "principal_123456789abc" as never, kind: "service" as const, source: "authenticated-adapter" as const };

test("PN10 policy decision point separates allow, deny, and review-required", async () => {
  const point = new BuiltinPolicyDecisionPoint();
  assert.equal((await point.evaluate({ operation: "coord.sync", resourceClass: "coordination", policyVersion: "local-1" })).decision, "ALLOW");
  assert.equal((await point.evaluate({ operation: "change.publish", resourceClass: "source", securityProfile: "review-required", policyVersion: "local-1" })).decision, "REVIEW_REQUIRED");
  assert.equal((await point.evaluate({ operation: "eval.status", resourceClass: "restricted", classification: "restricted", policyVersion: "local-1" })).decision, "DENY");
  assert.equal((await point.evaluate({ operation: "eval.status", resourceClass: "internal", principal: { id: "agent-self-declared" } as never, policyVersion: "local-1" })).decision, "DENY");
});

test("PN10 trusted principal validation excludes self-declared agent labels", () => {
  assert.equal(isTrustedPrincipal({ id: "principal_123456789abc", kind: "service", source: "authenticated-adapter" }), true);
  assert.equal(isTrustedPrincipal({ id: "agent-a", kind: "service", source: "authenticated-adapter" }), false);
});

test("PN10 approval binding rejects plan substitution and expiry", () => {
  const binding = { operationId: "proposal-1", planDigest: "plan-a", resourcePreconditionsDigest: "resources-a", policyVersion: "policy-1", principal, expiresAt: "2099-01-01T00:00:00.000Z" };
  const receipt = makeApprovalReceipt(binding);
  assert.equal(receipt.bindingDigest, approvalBindingDigest(binding));
  assert.equal(verifyApprovalReceipt(receipt, binding, new Date("2026-09-04T00:00:00.000Z")), true);
  assert.equal(verifyApprovalReceipt(receipt, { ...binding, planDigest: "plan-b" }, new Date("2026-09-04T00:00:00.000Z")), false);
  assert.equal(verifyApprovalReceipt(receipt, binding, new Date("2100-01-01T00:00:00.000Z")), false);
});

test("PN10 audit sink is bounded and content-minimized", async () => {
  const sink = new BoundedAuditSink(2);
  await sink.append({ id: "audit-1", occurredAt: "2026-09-04T00:00:00.000Z", operation: "coord.join", resultCode: "OK" });
  await sink.append({ id: "audit-2", occurredAt: "2026-09-04T00:00:01.000Z", operation: "coord.sync", resultCode: "OK" });
  await sink.append({ id: "audit-3", occurredAt: "2026-09-04T00:00:02.000Z", operation: "change.publish", resultCode: "ERR_STALE_RESOURCE" });
  const events = await sink.list();
  assert.deepEqual(events.map((event) => event.id), ["audit-3", "audit-2"]);
  assert.equal("content" in events[0]!, false);
});
