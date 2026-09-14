import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertPrivateKeyOutsideWorkspace,
  canonicalizeAdmissionSubject,
  createAdmissionAttestation,
  evaluateLocalAdmission,
  verifyAdmissionAttestation,
} from "@my-pi/change-runtime";

const BASE = "0123456789abcdef0123456789abcdef01234567";
const HEAD = "89abcdef0123456789abcdef0123456789abcdef";
const BLOB_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BLOB_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function subject(changes = [{ status: "modified" as const, path: "src\\main.ts", mode: "100644", blobOid: BLOB_A }]) {
  return canonicalizeAdmissionSubject({ repositoryIdentity: "github.com/example/my-pi", baseCommit: BASE, headCommit: HEAD, changes });
}

test("canonical admission subject is deterministic and excludes provenance artifacts", () => {
  const first = subject([
    { status: "modified", path: "src/main.ts", mode: "100644", blobOid: BLOB_A },
    { status: "added", path: ".my-pi/provenance/attestation.json", mode: "100644", blobOid: BLOB_B },
  ]);
  const second = subject([{ status: "modified", path: "src/main.ts", mode: "100644", blobOid: BLOB_A }]);
  assert.equal(first.subjectDigest, second.subjectDigest);
  assert.deepEqual(first.changes.map((change) => change.path), ["src/main.ts"]);
  assert.equal(first.canonical.includes("provenance"), false);
});

test("canonical admission subject captures rename, deletion, creation, and mode changes", () => {
  const value = canonicalizeAdmissionSubject({
    repositoryIdentity: "repo",
    baseCommit: BASE,
    changes: [
      { status: "renamed", path: "src/new.ts", previousPath: "src/old.ts", mode: "100755", blobOid: BLOB_A },
      { status: "deleted", path: "src/removed.ts", mode: "000000", absent: true },
      { status: "added", path: "src/new-file.ts", mode: "100644", blobOid: BLOB_B },
    ],
  });
  assert.equal(value.changes.length, 3);
  assert.deepEqual(value.changes.find((change) => change.path === "src/new.ts"), { status: "renamed", path: "src/new.ts", previousPath: "src/old.ts", mode: "100755", result: { blobOid: BLOB_A } });
  assert.deepEqual(value.changes.find((change) => change.path === "src/removed.ts")?.result, { absent: true });
});

test("canonical admission subject preserves Git symlink mode entries", () => {
  const value = canonicalizeAdmissionSubject({
    repositoryIdentity: "repo",
    baseCommit: BASE,
    changes: [{ status: "added", path: "bin/tool", mode: "120000", blobOid: BLOB_A }],
  });
  assert.deepEqual(value.changes[0], { status: "added", path: "bin/tool", mode: "120000", result: { blobOid: BLOB_A } });
});

test("local admission is fail-closed for unmanaged provenance and explicit for exemptions", () => {
  const value = subject([
    { status: "modified", path: "src/main.ts", mode: "100644", blobOid: BLOB_A },
    { status: "modified", path: "generated/report.json", mode: "100644", blobOid: BLOB_B },
  ]);
  const strict = evaluateLocalAdmission({
    subject: value,
    provenance: [
      { path: "src/main.ts", status: "managed", reasonCodes: ["verified_receipt_output"], receiptDigest: `sha256:${"1".repeat(64)}` },
      { path: "generated/report.json", status: "exempt", reasonCodes: ["configured_exemption"] },
    ],
    explicitExemptions: ["generated/**"],
  });
  assert.equal(strict.decision, "allowed");
  const bypass = evaluateLocalAdmission({
    subject: value,
    provenance: [{ path: "src/main.ts", status: "unmanaged", reasonCodes: ["receipt_missing"] }],
  });
  assert.equal(bypass.decision, "rejected");
  assert.equal(bypass.paths.find((item) => item.path === "generated/report.json")?.decision, "rejected");
});

test("strict local admission rejects unknown, stale, and missing lineage", () => {
  const value = subject([{ status: "modified", path: "src/main.ts", mode: "100644", blobOid: BLOB_A }]);
  for (const status of ["unknown", "stale_lineage"] as const) {
    const report = evaluateLocalAdmission({ subject: value, provenance: [{ path: "src/main.ts", status, reasonCodes: [status] }] });
    assert.equal(report.decision, "rejected");
    assert.equal(report.paths[0]?.decision, "rejected");
  }
  const missing = evaluateLocalAdmission({ subject: value, provenance: [] });
  assert.equal(missing.decision, "rejected");
  assert.ok(missing.reasonCodes.includes("provenance_missing"));
});

test("Ed25519 admission attestation verifies coverage and rejects tampering, wrong key, and stale issue time", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const coverage = [{ path: "src/main.ts", receiptDigest: `sha256:${"2".repeat(64)}` }];
  const attestation = createAdmissionAttestation({
    subjectDigest: subject().subjectDigest,
    repositoryIdentity: "github.com/example/my-pi",
    baseCommit: BASE,
    headCommit: HEAD,
    coveredReceipts: coverage,
    authorityKeyId: "local-1",
    privateKey: privateKeyPem,
    issuedAt: "2026-09-13T00:00:00.000Z",
  });
  const valid = verifyAdmissionAttestation({ attestation, authority: { keyId: "local-1", publicKeyPem }, expectedSubjectDigest: subject().subjectDigest, expectedCoverage: coverage, expectedBaseCommit: BASE, expectedHeadCommit: HEAD, now: "2026-09-13T01:00:00.000Z" });
  assert.equal(valid.valid, true);
  const tampered = verifyAdmissionAttestation({ attestation: { ...attestation, coveredReceipts: [{ ...coverage[0], path: "src/other.ts" }] }, authority: { keyId: "local-1", publicKeyPem }, expectedSubjectDigest: subject().subjectDigest, expectedCoverage: coverage, now: "2026-09-13T01:00:00.000Z" });
  assert.equal(tampered.valid, false);
  assert.ok(tampered.reasonCodes.includes("signature_invalid"));
  const wrongKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const wrongAuthority = verifyAdmissionAttestation({ attestation, authority: { keyId: "local-1", publicKeyPem: wrongKey }, expectedSubjectDigest: subject().subjectDigest, expectedCoverage: coverage, now: "2026-09-13T01:00:00.000Z" });
  assert.equal(wrongAuthority.valid, false);
  assert.ok(wrongAuthority.reasonCodes.includes("signature_invalid"));
  const stale = verifyAdmissionAttestation({ attestation, authority: { keyId: "local-1", publicKeyPem }, expectedSubjectDigest: subject().subjectDigest, expectedCoverage: coverage, now: "2026-09-14T01:00:00.000Z", maxAgeMs: 60 * 60 * 1_000 });
  assert.equal(stale.valid, false);
  assert.ok(stale.reasonCodes.includes("stale_attestation"));
});

test("private authority key paths inside the workspace are rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-pi-admission-workspace-"));
  try {
    assert.throws(() => assertPrivateKeyOutsideWorkspace(path.join(root, ".my-pi", "authority.pem"), [root]), /outside authorized workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
