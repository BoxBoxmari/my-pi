#!/usr/bin/env node
/**
 * Create the extended Production Next provenance manifest after product and
 * security gates have passed. It intentionally refuses a dirty candidate.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createReleaseManifest } from "./create-release-manifest.mjs";
import { resolveReleaseCommit } from "./release-identity.mjs";
import { candidateDirty, candidateStateDigest } from "./candidate-state.mjs";

const ROOT = process.cwd();

function parseArgs(args) {
  const values = {
    artifact: null,
    sbom: path.join(ROOT, "provenance", "SBOM.cdx.json"),
    benchmark: path.join(ROOT, "benchmarks", "results", "traversal-release.json"),
    output: path.join(ROOT, "dist-release", "production-next-manifest.json"),
    protocolMatrix: null,
    bootstrapRuntimeVersion: null,
    coordinationSchemaVersion: null,
    evaluationSchemaVersion: null,
    dbMigrationVersion: null,
    candidatePackageHashes: [],
    benchmarkEvidenceIds: [],
    promotionEligible: false,
  };
  const pathOptions = new Set(["artifact", "sbom", "benchmark", "output", "protocol-matrix"]);
  const valueOptions = new Set(["bootstrap-runtime-version", "coordination-schema-version", "evaluation-schema-version", "db-migration-version", "candidate-package-hash", "benchmark-evidence-id"]);
  const propertyNames = {
    "protocol-matrix": "protocolMatrix",
    "bootstrap-runtime-version": "bootstrapRuntimeVersion",
    "coordination-schema-version": "coordinationSchemaVersion",
    "evaluation-schema-version": "evaluationSchemaVersion",
    "db-migration-version": "dbMigrationVersion",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--promotion-eligible") {
      values.promotionEligible = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const name = arg.slice(2);
    if (!pathOptions.has(name) && !valueOptions.has(name)) throw new Error(`unknown argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    index += 1;
    if (pathOptions.has(name)) values[propertyNames[name] ?? name] = path.resolve(ROOT, value);
    else if (name === "candidate-package-hash") values.candidatePackageHashes.push(value);
    else if (name === "benchmark-evidence-id") values.benchmarkEvidenceIds.push(value);
    else values[propertyNames[name] ?? name] = value;
  }
  if (!values.artifact) throw new Error("--artifact is required");
  for (const [name, value] of [["--protocol-matrix", values.protocolMatrix], ["--bootstrap-runtime-version", values.bootstrapRuntimeVersion], ["--coordination-schema-version", values.coordinationSchemaVersion], ["--evaluation-schema-version", values.evaluationSchemaVersion], ["--db-migration-version", values.dbMigrationVersion]]) {
    if (!value) throw new Error(`${name} is required`);
  }
  if (!values.promotionEligible) throw new Error("--promotion-eligible is required after all product gates pass");
  if (values.benchmarkEvidenceIds.length === 0) values.benchmarkEvidenceIds.push("PN12");
  return values;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function main() {
  const paths = parseArgs(process.argv.slice(2));
  if (candidateDirty()) throw new Error("Production Next manifest requires a clean candidate checkout");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "verify-production-next-promotion.mjs")], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`Production Next promotion gate failed: ${String(error.stderr ?? error.message).trim().slice(-1_500)}`);
  }
  const releaseCommit = resolveReleaseCommit({ cwd: ROOT });
  const currentStateDigest = await candidateStateDigest();
  const [policy, appPackage, protocolCompatibilityMatrix, artifactSha256, sbomDigest, ...promotionEvidence] = await Promise.all([
    readFile(path.join(ROOT, "release", "release-policy.json"), "utf8").then((text) => JSON.parse(text)),
    readFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), "utf8").then((text) => JSON.parse(text)),
    readFile(paths.protocolMatrix, "utf8").then((text) => JSON.parse(text)),
    sha256File(paths.artifact),
    sha256File(paths.sbom),
    ...["PN6", "PN8", "PN9", "PN12"].map((id) => readFile(path.join(ROOT, "evidence", `${id}.json`), "utf8").then((text) => JSON.parse(text))),
  ]);
  for (const evidence of promotionEvidence) {
    if (evidence.status !== "ACCEPTED" || evidence.promotionEligible !== true || evidence.commit !== releaseCommit || evidence.candidateDirty !== false || evidence.candidateStateDigest !== currentStateDigest) {
      throw new Error(`promotion evidence ${evidence.id ?? "unknown"} is not accepted and bound to the clean candidate`);
    }
    if ((evidence.id === "PN6" || evidence.id === "PN8") && evidence.evidenceKind !== "observed_replay") throw new Error(`promotion evidence ${evidence.id} must come from an observed replay, not a controlled fixture`);
    if (evidence.id === "PN9" && (evidence.stableNMinusOneVerified !== true || evidence.bootstrapSha === evidence.commit)) throw new Error("PN9 promotion evidence must prove a distinct stable N-1 bootstrap");
  }
  const candidatePackageHashes = { [appPackage.name]: artifactSha256 };
  for (const value of paths.candidatePackageHashes) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error("--candidate-package-hash must be NAME=SHA256");
    candidatePackageHashes[value.slice(0, separator)] = value.slice(separator + 1);
  }
  const productionNext = {
    sourceCommit: releaseCommit,
    bootstrapRuntimeVersion: paths.bootstrapRuntimeVersion,
    candidatePackageHashes,
    sbomDigest,
    coordinationSchemaVersion: paths.coordinationSchemaVersion,
    evaluationSchemaVersion: paths.evaluationSchemaVersion,
    dbMigrationVersion: Number(paths.dbMigrationVersion),
    protocolCompatibilityMatrix,
    selfHostEvidenceId: "PN9",
    evaluationBenchmarkEvidenceId: "PN8",
    benchmarkEvidenceIds: paths.benchmarkEvidenceIds,
    candidateDirty: false,
    promotionEligible: true,
  };
  const manifest = await createReleaseManifest({ artifactPath: paths.artifact, sbomPath: paths.sbom, benchmarkPath: paths.benchmark, outputPath: paths.output, policy, appPackage, releaseCommit, productionNext });
  console.log(`Production Next manifest written: ${paths.output}`);
  console.log(`  source commit: ${manifest.productionNext.sourceCommit}`);
  console.log(`  self-host evidence: ${manifest.productionNext.selfHostEvidenceId}`);
}

await main().catch((error) => {
  console.error(`[PRODUCTION NEXT MANIFEST] ${error.message}`);
  process.exitCode = 1;
});
