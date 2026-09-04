#!/usr/bin/env node
/**
 * Create and validate the machine-readable provenance record for one release.
 * The manifest is written only after all referenced files and candidate
 * bindings have been checked.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FULL_COMMIT_PATTERN, resolveReleaseCommit } from "./release-identity.mjs";

const ROOT = process.cwd();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function parseArgs(args) {
  const values = {
    artifact: null,
    sbom: path.join(ROOT, "provenance", "SBOM.cdx.json"),
    benchmark: path.join(ROOT, "benchmarks", "results", "traversal-release.json"),
    output: path.join(ROOT, "dist-release", "release-manifest.json"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!["--artifact", "--sbom", "--benchmark", "--output"].includes(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error(`${arg} requires a path`);
    values[arg.slice(2)] = path.resolve(ROOT, value);
    index += 1;
  }
  if (!values.artifact) throw new Error("--artifact is required");
  return values;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function validateProductionNext(productionNext, { releaseCommit, artifactSha256, sbomSha256 }) {
  const errors = [];
  if (!productionNext || typeof productionNext !== "object") return ["productionNext must be an object"];
  if (!FULL_COMMIT_PATTERN.test(productionNext.sourceCommit ?? "") || productionNext.sourceCommit !== releaseCommit) errors.push(`productionNext.sourceCommit must equal candidate commit ${releaseCommit}`);
  if (productionNext.candidateDirty !== false) errors.push("productionNext.candidateDirty must be false");
  if (typeof productionNext.bootstrapRuntimeVersion !== "string" || !productionNext.bootstrapRuntimeVersion.trim()) errors.push("productionNext.bootstrapRuntimeVersion is missing");
  if (productionNext.sbomDigest !== sbomSha256) errors.push("productionNext.sbomDigest must match the manifest SBOM digest");
  if (!productionNext.coordinationSchemaVersion || !productionNext.evaluationSchemaVersion) errors.push("productionNext schema versions are required");
  if (!Number.isSafeInteger(productionNext.dbMigrationVersion) || productionNext.dbMigrationVersion < 1) errors.push("productionNext.dbMigrationVersion must be a positive safe integer");
  if (!productionNext.protocolCompatibilityMatrix || typeof productionNext.protocolCompatibilityMatrix !== "object") errors.push("productionNext.protocolCompatibilityMatrix is required");
  if (productionNext.selfHostEvidenceId !== "PN9") errors.push("productionNext.selfHostEvidenceId must be PN9");
  if (productionNext.evaluationBenchmarkEvidenceId !== "PN8") errors.push("productionNext.evaluationBenchmarkEvidenceId must be PN8");
  if (!Array.isArray(productionNext.benchmarkEvidenceIds) || productionNext.benchmarkEvidenceIds.length === 0 || productionNext.benchmarkEvidenceIds.some((id) => typeof id !== "string" || id.length === 0)) errors.push("productionNext.benchmarkEvidenceIds must be a non-empty string array");
  const packageHashes = productionNext.candidatePackageHashes;
  if (!packageHashes || typeof packageHashes !== "object" || Array.isArray(packageHashes) || Object.keys(packageHashes).length === 0 || Object.values(packageHashes).some((digest) => !SHA256_PATTERN.test(digest ?? ""))) errors.push("productionNext.candidatePackageHashes must contain SHA-256 package hashes");
  else if (!Object.values(packageHashes).includes(artifactSha256)) errors.push("productionNext.candidatePackageHashes must include the qualified artifact hash");
  if (productionNext.promotionEligible !== true) errors.push("productionNext.promotionEligible must be true only after all product gates pass");
  return errors;
}

function validateManifest(manifest, { policy, appPackage, releaseCommit, artifactPath, sbomPath, benchmarkPath, benchmark }) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (manifest.releaseVersion !== policy.version) errors.push(`releaseVersion must be ${policy.version}`);
  if (manifest.releaseChannel !== policy.releaseChannel) errors.push(`releaseChannel must be ${policy.releaseChannel}`);
  if (!FULL_COMMIT_PATTERN.test(manifest.releaseCommit ?? "") || manifest.releaseCommit !== releaseCommit) {
    errors.push(`releaseCommit must equal candidate commit ${releaseCommit}`);
  }
  if (manifest.artifact?.file !== path.basename(artifactPath)) errors.push("artifact.file does not match the qualified TGZ");
  if (!SHA256_PATTERN.test(manifest.artifact?.sha256 ?? "")) errors.push("artifact.sha256 must be a SHA-256 digest");
  if (manifest.sbom?.file !== relativePath(sbomPath)) errors.push("sbom.file does not match the qualified SBOM");
  if (!SHA256_PATTERN.test(manifest.sbom?.sha256 ?? "")) errors.push("sbom.sha256 must be a SHA-256 digest");
  if (manifest.benchmark?.file !== relativePath(benchmarkPath)) errors.push("benchmark.file does not match the release benchmark");
  if (manifest.benchmark?.profile !== "release") errors.push("benchmark.profile must be release");
  if (manifest.benchmark?.commit !== releaseCommit) errors.push("benchmark.commit does not match the release commit");
  if (manifest.benchmark?.releaseVersion !== policy.version) errors.push("benchmark.releaseVersion does not match the release version");
  const minimumReleaseFiles = policy.benchmarkQualification?.release?.minTarget ?? 100000;
  if (typeof manifest.benchmark?.observedFileCount !== "number" || manifest.benchmark.observedFileCount < minimumReleaseFiles) {
    errors.push(`benchmark.observedFileCount must be at least ${minimumReleaseFiles}`);
  }
  if (typeof manifest.qualificationTimestamp !== "string" || !manifest.qualificationTimestamp.trim()) {
    errors.push("qualificationTimestamp is missing");
  }
  if (appPackage.name !== policy.packageName || appPackage.version !== policy.version) {
    errors.push("publishable package metadata does not match the release policy");
  }
  if (benchmark.observedFileCount < benchmark.targetFileCount) errors.push("benchmark observed count is below its target");
  if (manifest.productionNext !== undefined) errors.push(...validateProductionNext(manifest.productionNext, { releaseCommit, artifactSha256: manifest.artifact.sha256, sbomSha256: manifest.sbom.sha256 }));
  return { ok: errors.length === 0, errors };
}

export async function createReleaseManifest({ artifactPath, sbomPath, benchmarkPath, outputPath, policy, appPackage, releaseCommit, productionNext, now = new Date() }) {
  const [artifactSha256, sbomSha256, benchmark] = await Promise.all([
    sha256File(artifactPath),
    sha256File(sbomPath),
    readFile(benchmarkPath, "utf8").then((text) => JSON.parse(text)),
  ]);
  const manifest = {
    schemaVersion: 1,
    releaseVersion: policy.version,
    releaseChannel: policy.releaseChannel,
    releaseCommit,
    artifact: { file: path.basename(artifactPath), sha256: artifactSha256 },
    sbom: { file: relativePath(sbomPath), sha256: sbomSha256 },
    benchmark: {
      file: relativePath(benchmarkPath),
      profile: benchmark.profile,
      releaseVersion: benchmark.releaseVersion,
      commit: benchmark.commit,
      targetFileCount: benchmark.targetFileCount,
      observedFileCount: benchmark.observedFileCount,
    },
    qualificationTimestamp: now.toISOString(),
    ...(productionNext === undefined ? {} : { productionNext }),
  };
  const validation = validateManifest(manifest, { policy, appPackage, releaseCommit, artifactPath, sbomPath, benchmarkPath, benchmark });
  if (!validation.ok) throw new Error(`release manifest validation failed: ${validation.errors.join("; ")}`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const [policy, appPackage] = await Promise.all([
    readFile(path.join(ROOT, "release", "release-policy.json"), "utf8").then((text) => JSON.parse(text)),
    readFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), "utf8").then((text) => JSON.parse(text)),
  ]);
  const releaseCommit = resolveReleaseCommit({ cwd: ROOT });
  const manifest = await createReleaseManifest({
    artifactPath: paths.artifact,
    sbomPath: paths.sbom,
    benchmarkPath: paths.benchmark,
    outputPath: paths.output,
    policy,
    appPackage,
    releaseCommit,
  });
  console.log(`Release manifest written: ${paths.output}`);
  console.log(`  artifact: ${manifest.artifact.file} (${manifest.artifact.sha256})`);
  console.log(`  sbom: ${manifest.sbom.file} (${manifest.sbom.sha256})`);
  console.log(`  release commit: ${manifest.releaseCommit}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main().catch((err) => {
    console.error(`[RELEASE MANIFEST] ${err.message}`);
    process.exitCode = 1;
  });
}
