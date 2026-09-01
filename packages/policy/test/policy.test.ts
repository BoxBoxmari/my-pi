import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SensitivePathPolicy,
  DEFAULT_SENSITIVE_PATTERNS,
  matchesSensitivePattern,
  PolicyEngine,
} from "@ccr/policy";
import type { WorkspacePolicy } from "@ccr/contracts";

test("default sensitive rules match expected paths", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive(".env"), ".env");
  assert.equal(p.isSensitive("sub/.env"), ".env");
  assert.equal(p.isSensitive("secrets/keys.json"), "secrets*");
  assert.equal(p.isSensitive("config/credentials.yml"), "credentials*");
  assert.equal(p.isSensitive("certs/id_rsa.key"), "*.key");
  assert.equal(p.isSensitive("certs/ca.pem"), "*.pem");
  assert.equal(p.isSensitive(".ssh/id_ed25519"), ".ssh/**");
  assert.equal(p.isSensitive(".aws/credentials"), ".aws/**");
  assert.equal(p.isSensitive("src/foo.ts"), undefined);
});

test("glob matcher: basename and recursive dir patterns", () => {
  assert.equal(matchesSensitivePattern("deep/nested/.env.production", ".env.*"), true);
  assert.equal(matchesSensitivePattern("deep/.npmrc", ".npmrc"), true);
  assert.equal(matchesSensitivePattern("src/app.ts", ".ssh/**"), false);
  assert.equal(matchesSensitivePattern("a/b/c/.ssh/x", ".ssh/**"), false);
});

test("PolicyEngine enforces secret deny and mode gating", () => {
  const engine = new PolicyEngine();
  const wp: WorkspacePolicy = { mode: "workspace-write", allowedSensitivePaths: [] };
  assert.deepEqual(engine.authorize(wp, "read", "src/foo.ts"), { allowed: true });
  assert.deepEqual(engine.authorize(wp, "read", ".env"), { allowed: false, reason: "secret-path-denied" });
  assert.deepEqual(engine.authorize(wp, "write", "src/foo.ts"), { allowed: true });
  assert.deepEqual(engine.authorize(wp, "exec", "src/foo.ts"), { allowed: false, reason: "unavailable-class" });
  const readOnly: WorkspacePolicy = { mode: "read-only", allowedSensitivePaths: [] };
  assert.deepEqual(engine.authorize(readOnly, "read", "src/foo.ts"), { allowed: true });
  assert.deepEqual(engine.authorize(readOnly, "write", "src/foo.ts"), { allowed: false, reason: "mode-denied" });
  const withAllow: WorkspacePolicy = { mode: "workspace-write", allowedSensitivePaths: [".env.local"] };
  assert.deepEqual(engine.authorize(withAllow, "read", ".env.local"), { allowed: true });
  assert.deepEqual(engine.authorize(withAllow, "read", ".env"), { allowed: false, reason: "secret-path-denied" });
});
