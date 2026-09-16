import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestRouter, SUPPORTED_OPERATIONS } from "../dist/request-router.js";

// operation name | project-scoped? | mutating? | readiness/test-mode gated?
const EXPECTED_INVENTORY = [
  ["health", false, false, false],
  ["coord_join", false, true, false],
  ["coord_claim", true, true, false],
  ["coord_intent", true, true, false],
  ["coord_sync", true, false, false],
  ["coord_publish", true, true, false],
  ["coord_complete", true, true, false],
  ["coord_create_work_item", true, true, false],
  ["change_record", false, true, false],
  ["code_state_index", true, false, true],
  ["code_state_snapshot", true, false, false],
  ["graph_snapshot", true, false, false],
  ["graph_expand", true, false, false],
  ["graph_trace", true, false, false],
  ["graph_events", true, false, false],
  ["provenance_report", true, false, false],
  ["eval_register_spec", false, true, false],
  ["eval_request", false, true, false],
  ["eval_record", false, true, false],
  ["eval_evaluate", false, true, false],
  ["eval_complete", false, true, false],
  ["eval_status", false, false, false],
  ["audit_list", true, false, false],
  ["append_event", true, true, true],
  ["list_events", true, false, false],
  ["get_projection", true, false, false],
  ["idempotency_check", false, false, false],
  ["idempotency_record", false, true, true],
];

test("operation inventory: every IPC method remains registered after refactor", () => {
  assert.deepEqual([...SUPPORTED_OPERATIONS], EXPECTED_INVENTORY.map(([method]) => method));
});

function stubDeps(overrides = {}) {
  const audits = [];
  const store = {
    appendAudit: async (record) => { audits.push(record); },
  };
  return {
    deps: {
      runtime: {},
      evaluation: {},
      store,
      health: () => ({ ok: true }),
      expectedProjectId: "project_test",
      testMode: false,
      ...overrides,
    },
    audits,
  };
}

function request(method, params = {}) {
  return {
    protocolVersion: "1",
    requestId: "test-request",
    method,
    params,
    clientInfo: { name: "inventory-test", version: "0" },
  };
}

test("router rejects unknown methods without losing the audit trail", async () => {
  const { deps, audits } = stubDeps();
  const router = createRequestRouter(deps);
  await assert.rejects(() => router.handle(request("no_such_method")), /unsupported coordination method/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].operation, "no_such_method");
  assert.equal(audits[0].policyDecision, "DENY");
});

test("router serves health without a project scope and audits ALLOW", async () => {
  const { deps, audits } = stubDeps();
  const router = createRequestRouter(deps);
  const result = await router.handle(request("health"));
  assert.deepEqual(result, { ok: true });
  assert.equal(audits[0].policyDecision, "ALLOW");
});

test("router enforces project scope on project-scoped operations", async () => {
  const { deps } = stubDeps();
  const router = createRequestRouter(deps);
  await assert.rejects(
    () => router.handle(request("graph_snapshot", { projectId: "project_other", kind: "code" })),
    /does not match this daemon/,
  );
});
