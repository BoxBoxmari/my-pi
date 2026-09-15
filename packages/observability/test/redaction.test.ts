import assert from "node:assert/strict";
import { test } from "node:test";
import { redactEventForWire, redactPayloadDeep, redactTextDeep, isSensitivePath } from "../dist/index.js";

interface WireEvent {
  schemaVersion: string;
  projectId: string;
  sequence: bigint;
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: { kind: string; name?: string; id?: string };
  payload: Record<string, unknown>;
}

test("redactEventForWire masks nested secret keys, bearer text, sensitive paths; idempotent; sequence untouched", () => {
  const raw: WireEvent = {
    schemaVersion: "1",
    projectId: "proj-x",
    sequence: 42n,
    eventId: "evt-42",
    eventType: "WorkItemCreated",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "system", name: "runner bearer: abcdef123.456-ghi" },
    payload: {
      token: "NEVER_ON_WIRE_TOKEN",
      nested: { apiKey: "sk-ABCDEFGHIJKLMNOP0123456789", changedPath: "src/main.ts" },
      files: [{ path: "/home/dev/.ssh/id_rsa" }, { root: "C:\\Users\\dev\\.aws\\credentials" }],
      uri: "file:///etc/.env.production",
      log: "rotate ghp_ABCDEFGHIJKLMNOPQRST1234 next",
      key: "-----BEGIN RSA KEY-----",
      worktreeId: "wt-1",
      counter: 7,
      flag: true,
      missing: null,
    },
  };
  const wire = redactEventForWire(raw);
  const text = JSON.stringify(wire, (_key, value) => (typeof value === "bigint" ? value.toString() : value));

  assert.equal(typeof raw.sequence, "bigint");
  assert.equal(wire.sequence, 42n);
  assert.equal(wire.eventId, "evt-42");
  assert.equal(wire.projectId, "proj-x");
  assert.equal(wire.eventType, "WorkItemCreated");

  assert.ok(text.includes("[REDACTED]"));
  assert.ok(text.includes("[REDACTED:SECRET]"));
  assert.ok(text.includes("[PATH:REDACTED]"));
  for (const leak of [
    "NEVER_ON_WIRE_TOKEN",
    "sk-ABCDEFGHIJKLMNOP0123456789",
    "id_rsa",
    "ghp_ABCDEFGHIJKLMNOPQRST1234",
    "abcdef123.456-ghi",
    "BEGIN RSA KEY",
    ".env.production",
    ".aws",
    ".ssh",
  ]) {
    assert.ok(!text.includes(leak), `wire output must not contain ${leak}`);
  }

  const payload = wire.payload as Record<string, any>;
  assert.equal(payload.token, "[REDACTED]");
  assert.equal(payload.nested.apiKey, "[REDACTED]");
  assert.equal(payload.nested.changedPath, "src/main.ts");
  assert.equal(payload.files[0].path, "[PATH:REDACTED]");
  assert.equal(payload.files[1].root, "[PATH:REDACTED]");
  assert.equal(payload.uri, "[PATH:REDACTED]");
  assert.equal(payload.worktreeId, "wt-1");
  assert.equal(payload.counter, 7);
  assert.equal(payload.flag, true);
  assert.equal(payload.missing, null);
  assert.equal((wire.actor.name ?? "").includes("[REDACTED]"), true);

  assert.deepEqual(redactEventForWire(wire), wire);
  assert.deepEqual(redactPayloadDeep(payload), payload);
  assert.equal((raw.payload as Record<string, unknown>).token, "NEVER_ON_WIRE_TOKEN");

  assert.equal(isSensitivePath("/a/.env.local"), true);
  assert.equal(isSensitivePath("C:\\Users\\x\\.npmrc"), true);
  assert.equal(isSensitivePath("relative/dir/secrets/app.txt"), true);
  assert.equal(isSensitivePath("src/main.ts"), false);
  assert.equal(isSensitivePath("[PATH:REDACTED]"), false);
  assert.equal(redactTextDeep("plain text"), "plain text");
  assert.equal(redactTextDeep("plain text"), "plain text");
});

test("redactTextDeep masks sensitive path shapes inside free-text values at any position; benign values untouched", () => {
  const leaky = [
    "read /home/zeta9/.ssh/id_zkey",
    "loaded /deploy/.env.zeta9",
    "C:/Users/x/.aws/credentials",
    "C:\\Users\\x\\.aws\\credentials",
    "svc/zeta9/aws/credentials",
  ];
  for (const value of leaky) {
    const masked = redactTextDeep(value);
    assert.ok(masked.includes("[PATH:REDACTED]"), `${value} must end as [PATH:REDACTED]`);
    assert.ok(!masked.includes("zeta9"), `zeta9 fragment must not survive in ${value}`);
    assert.ok(!masked.includes("id_zkey"), `id_zkey fragment must not survive in ${value}`);
    assert.ok(!masked.includes(".ssh") && !masked.includes(".aws") && !masked.includes(".env"), `path segment must not survive in ${value}`);
  }
  assert.equal(redactTextDeep("work:item:W1"), "work:item:W1");
  assert.equal(redactTextDeep("sync took 3ms"), "sync took 3ms");
});

test("PATH-TEXT mask is an idempotent fixed-point", () => {
  for (const value of [
    "read /home/zeta9/.ssh/id_zkey",
    "work:item:W1",
    "[PATH:REDACTED]",
    "rotate ghp_ABCDEFGHIJKLMNOPQRST1234 next",
    "C:/Users/x/.aws/credentials",
  ]) {
    const once = redactTextDeep(value);
    assert.equal(redactTextDeep(once), once);
  }
});

test("secret masks do not regress under the free-text path stage", () => {
  assert.equal(redactTextDeep("sk-ABCDEFGHIJKLMNOP0123456789"), "[REDACTED:SECRET]");
  assert.equal(redactTextDeep("ghp_ABCDEFGHIJKLMNOPQRST1234"), "[REDACTED:SECRET]");
  assert.equal(redactTextDeep("xoxb-1234567890-abcdef"), "[REDACTED:SECRET]");
  assert.equal(redactTextDeep("-----BEGIN RSA KEY-----"), "[REDACTED:SECRET]");
  const composite = redactTextDeep("/home/dev/.ssh/sk-ABCDEFGHIJKLMNOP0123456789");
  assert.equal(composite, "[PATH:REDACTED]");
});

test("existing path-under-pathish-key whole-value masking unchanged", () => {
  const event: WireEvent = {
    schemaVersion: "1",
    projectId: "proj-x",
    sequence: 7n,
    eventId: "evt-7",
    eventType: "WorkItemCreated",
    occurredAt: "2026-09-15T00:00:00.000Z",
    actor: { kind: "system" },
    payload: {
      files: [{ path: "/home/dev/.ssh/id_rsa" }],
      uri: "file:///etc/.env.production",
    },
  };
  const wire = redactEventForWire(event);
  const payload = wire.payload as Record<string, any>;
  assert.equal(payload.files[0].path, "[PATH:REDACTED]");
  assert.equal(payload.uri, "[PATH:REDACTED]");
  assert.deepEqual(redactEventForWire(wire), wire);
});
