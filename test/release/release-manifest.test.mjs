import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReleaseManifest } from "../../scripts/create-release-manifest.mjs";

const ROOT = process.cwd();
const RELEASE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const policy = { packageName: "@koonwang03/my-pi", version: "0.1.0-alpha.1", releaseChannel: "alpha" };
const appPackage = { name: policy.packageName, version: policy.version };

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-release-manifest-"));
  const artifactPath = path.join(dir, "koonwang03-my-pi-0.1.0-alpha.1.tgz");
  const sbomPath = path.join(dir, "SBOM.cdx.json");
  const benchmarkPath = path.join(dir, "traversal-release.json");
  const outputPath = path.join(dir, "release-manifest.json");
  await writeFile(artifactPath, "candidate artifact bytes", "utf8");
  await writeFile(sbomPath, "candidate sbom bytes", "utf8");
  await writeFile(benchmarkPath, JSON.stringify({
    profile: "release",
    releaseVersion: policy.version,
    commit: RELEASE_COMMIT,
    targetFileCount: 100000,
    observedFileCount: 100007,
  }), "utf8");
  return { dir, artifactPath, sbomPath, benchmarkPath, outputPath };
}

test("release manifest binds artifact, SBOM, benchmark, version, channel, and commit", async () => {
  const paths = await fixture();
  try {
    const manifest = await createReleaseManifest({
      ...paths,
      policy,
      appPackage,
      releaseCommit: RELEASE_COMMIT,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    const persisted = JSON.parse(await readFile(paths.outputPath, "utf8"));
    assert.deepEqual(persisted, manifest);
    assert.equal(manifest.releaseCommit, RELEASE_COMMIT);
    assert.match(manifest.artifact.sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.sbom.sha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.benchmark.observedFileCount, 100007);
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("release manifest rejects stale benchmark evidence", async () => {
  const paths = await fixture();
  try {
    const benchmark = JSON.parse(await readFile(paths.benchmarkPath, "utf8"));
    benchmark.commit = "0000000000000000000000000000000000000000";
    await writeFile(paths.benchmarkPath, JSON.stringify(benchmark), "utf8");
    await assert.rejects(
      createReleaseManifest({ ...paths, policy, appPackage, releaseCommit: RELEASE_COMMIT }),
      /benchmark.commit does not match the release commit/,
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("Production Next manifest binds extended provenance and rejects a dirty candidate", async () => {
  const paths = await fixture();
  try {
    const sbomDigest = createHash("sha256").update("candidate sbom bytes", "utf8").digest("hex");
    const artifactDigest = createHash("sha256").update("candidate artifact bytes", "utf8").digest("hex");
    const productionNext = {
      sourceCommit: RELEASE_COMMIT,
      bootstrapRuntimeVersion: "0.1.0-alpha.1",
      candidatePackageHashes: { "@koonwang03/my-pi": artifactDigest },
      sbomDigest,
      coordinationSchemaVersion: "1",
      evaluationSchemaVersion: "1",
      dbMigrationVersion: 4,
      protocolCompatibilityMatrix: { legacy: "qualified", coordination: "candidate" },
      selfHostEvidenceId: "PN9",
      evaluationBenchmarkEvidenceId: "PN8",
      benchmarkEvidenceIds: ["PN12"],
      candidateDirty: false,
      promotionEligible: true,
    };
    const manifest = await createReleaseManifest({ ...paths, policy, appPackage, releaseCommit: RELEASE_COMMIT, productionNext });
    assert.deepEqual(manifest.productionNext, productionNext);
    await assert.rejects(
      createReleaseManifest({ ...paths, policy, appPackage, releaseCommit: RELEASE_COMMIT, productionNext: { ...productionNext, candidateDirty: true } }),
      /candidateDirty must be false/,
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});
