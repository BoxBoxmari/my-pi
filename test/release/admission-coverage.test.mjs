import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function runVerifier(root, fixture, paths, base, head) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(root, "scripts", "verify-my-pi-admission.mjs"),
      "--root", fixture,
      "--base", base,
      "--head", head,
      "--provenance", paths.provenance,
      "--attestation", paths.attestation,
      "--authority", paths.authority,
      "--coverage", paths.coverage,
      "--report-only",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(output);
}

test("admission coverage is exact and stale subjects require review", async () => {
  const root = process.cwd();
  const fixture = await mkdtemp(path.join(os.tmpdir(), "my-pi-admission-coverage-"));
  const keyPath = path.join(os.tmpdir(), "my-pi-admission-coverage-" + process.pid + "-" + Date.now() + ".pem");
  try {
    await mkdir(path.join(fixture, "src"), { recursive: true });
    git(fixture, ["init", "-b", "main"]);
    git(fixture, ["config", "user.email", "my-pi-test@example.invalid"]);
    git(fixture, ["config", "user.name", "my-pi test"]);
    await writeFile(path.join(fixture, "src", "feature.txt"), "base\n", "utf8");
    git(fixture, ["add", "src/feature.txt"]);
    git(fixture, ["commit", "-m", "base"]);
    const base = git(fixture, ["rev-parse", "HEAD"]);

    await writeFile(path.join(fixture, "src", "feature.txt"), "candidate\n", "utf8");
    git(fixture, ["add", "src/feature.txt"]);
    git(fixture, ["commit", "-m", "candidate"]);
    const firstHead = git(fixture, ["rev-parse", "HEAD"]);

    const receiptDigest = "sha256:" + "1".repeat(64);
    const coveragePath = path.join(fixture, "coverage.json");
    const provenancePath = path.join(fixture, "provenance.json");
    const attestationPath = path.join(fixture, ".my-pi", "provenance", "admission-attestation.json");
    const authorityPath = path.join(fixture, ".my-pi", "provenance", "authority.json");
    await mkdir(path.dirname(attestationPath), { recursive: true });
    await writeJson(coveragePath, [{ path: "src/feature.txt", receiptDigest }]);
    await writeJson(provenancePath, [{ path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest }]);

    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts", "seal-my-pi-admission.mjs"),
        "--root", fixture,
        "--base", base,
        "--head", firstHead,
        "--coverage", coveragePath,
        "--key-id", "coverage-regression",
        "--key-path", keyPath,
      ],
      { cwd: root, encoding: "utf8" },
    );

    const paths = { coverage: coveragePath, provenance: provenancePath, attestation: attestationPath, authority: authorityPath };
    const allowed = runVerifier(root, fixture, paths, base, firstHead);
    assert.equal(allowed.status, "allowed");

    const missingProvenancePath = path.join(fixture, "missing-provenance.json");
    await writeJson(missingProvenancePath, []);
    const missing = runVerifier(root, fixture, { ...paths, provenance: missingProvenancePath }, base, firstHead);
    assert.equal(missing.status, "rejected");
    assert.ok(missing.localAdmission.reasonCodes.includes("provenance_missing"));

    const tamperedPath = path.join(fixture, "tampered-attestation.json");
    const tampered = JSON.parse(await readFile(attestationPath, "utf8"));
    tampered.subjectDigest = "sha256:" + "f".repeat(64);
    await writeJson(tamperedPath, tampered);
    const tamperedReport = runVerifier(root, fixture, { ...paths, attestation: tamperedPath }, base, firstHead);
    assert.equal(tamperedReport.status, "review_required");
    assert.ok(tamperedReport.attestation.reasonCodes.includes("subject_mismatch"));

    const wrongAuthorityPath = path.join(fixture, "wrong-authority.json");
    const wrongKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    const authority = JSON.parse(await readFile(authorityPath, "utf8"));
    authority.publicKeyPem = wrongKey;
    await writeJson(wrongAuthorityPath, authority);
    const wrongAuthority = runVerifier(root, fixture, { ...paths, authority: wrongAuthorityPath }, base, firstHead);
    assert.equal(wrongAuthority.status, "review_required");
    assert.ok(wrongAuthority.attestation.reasonCodes.includes("signature_invalid"));

    await writeFile(path.join(fixture, "src", "feature.txt"), "stale-head\n", "utf8");
    git(fixture, ["add", "src/feature.txt"]);
    git(fixture, ["commit", "-m", "stale head"]);
    const staleHead = git(fixture, ["rev-parse", "HEAD"]);
    const stale = runVerifier(root, fixture, paths, base, staleHead);
    assert.equal(stale.status, "review_required");
    assert.ok(stale.attestation.reasonCodes.includes("head_mismatch"));
    assert.ok(stale.attestation.reasonCodes.includes("subject_mismatch"));

    await writeFile(path.join(fixture, "src", "extra.txt"), "extra\n", "utf8");
    git(fixture, ["add", "src/extra.txt"]);
    git(fixture, ["commit", "-m", "extra path"]);
    const extraHead = git(fixture, ["rev-parse", "HEAD"]);
    const extraProvenancePath = path.join(fixture, "extra-provenance.json");
    await writeJson(extraProvenancePath, [
      { path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest },
      { path: "src/extra.txt", status: "managed", reasonCodes: [], receiptDigest: "sha256:" + "2".repeat(64) },
    ]);
    assert.throws(
      () => execFileSync(
        process.execPath,
        [
          path.join(root, "scripts", "seal-my-pi-admission.mjs"),
          "--root", fixture,
          "--base", base,
          "--head", extraHead,
          "--coverage", coveragePath,
          "--key-id", "coverage-regression",
          "--key-path", keyPath,
        ],
        { cwd: root, encoding: "utf8" },
      ),
      /coverage must contain exactly one verified receipt mapping/,
    );
    const extra = runVerifier(root, fixture, { ...paths, provenance: extraProvenancePath }, base, extraHead);
    assert.equal(extra.status, "review_required");
    assert.deepEqual(extra.attestation.reasonCodes, ["coverage_paths_mismatch"]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(keyPath, { force: true });
  }
});
