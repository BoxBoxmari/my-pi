import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SensitivePathPolicy,
  DEFAULT_SENSITIVE_PATTERNS,
  matchesSensitivePattern,
  PolicyEngine,
} from "@my-pi/policy";
import type { WorkspacePolicy } from "@my-pi/contracts";

// Adversarial: case variants must not bypass the deny list on
// case-sensitive filesystems.
test("case-insensitive: .ENV / .Env match .env rules", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive(".ENV"), ".env");
  assert.equal(p.isSensitive(".Env"), ".env");
  assert.equal(p.isSensitive("sub/.ENV"), ".env");
  assert.equal(matchesSensitivePattern(".ENV", ".env"), true);
  assert.equal(matchesSensitivePattern("sub/.Env", ".env"), true);
});

test("case-insensitive: .env.* variants", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive(".ENV.PRODUCTION"), ".env.*");
  assert.equal(p.isSensitive("deep/nested/.Env.local"), ".env.*");
  assert.equal(matchesSensitivePattern("deep/nested/.ENV.PRODUCTION", ".env.*"), true);
});

test("case-insensitive: .AWS/config and .SSH paths", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive(".AWS/config"), ".aws/**");
  assert.equal(p.isSensitive(".Aws/credentials"), ".aws/**");
  assert.equal(p.isSensitive(".SSH/id_ed25519"), ".ssh/**");
  assert.equal(p.isSensitive(".Ssh/config"), ".ssh/**");
  assert.equal(matchesSensitivePattern(".AWS/CONFIG", ".aws/**"), true);
});

test("case-insensitive: CREDENTIALS / Secrets prefixes and key extensions", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive("CREDENTIALS"), "credentials*");
  assert.equal(p.isSensitive("config/CREDENTIALS.yml"), "credentials*");
  assert.equal(p.isSensitive("Secrets/foo"), "secrets*");
  assert.equal(p.isSensitive("SECRETS/keys.json"), "secrets*");
  assert.equal(p.isSensitive("certs/ID_RSA.KEY"), "*.key");
  assert.equal(p.isSensitive("certs/CA.PEM"), "*.pem");
  assert.equal(p.isSensitive("certs/cert.P12"), "*.p12");
  assert.equal(p.isSensitive("certs/cert.PFX"), "*.pfx");
});

test("case-insensitive: non-sensitive paths still allowed", () => {
  const p = new SensitivePathPolicy(DEFAULT_SENSITIVE_PATTERNS);
  assert.equal(p.isSensitive("src/foo.ts"), undefined);
  assert.equal(p.isSensitive("src/ENVIRONMENT.ts"), undefined);
  const engine = new PolicyEngine();
  const wp: WorkspacePolicy = { mode: "workspace-write", allowedSensitivePaths: [] };
  assert.deepEqual(engine.authorize(wp, "read", ".ENV"), { allowed: false, reason: "secret-path-denied" });
  assert.deepEqual(engine.authorize(wp, "read", "Secrets/foo"), { allowed: false, reason: "secret-path-denied" });
});
