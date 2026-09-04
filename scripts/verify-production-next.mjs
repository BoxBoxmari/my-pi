#!/usr/bin/env node
/**
 * Read-only Production Next readiness report.
 * This is not a release-admission replacement and never rewrites evidence.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { baselineAssessment } from "./baseline-ancestry.mjs";

const ROOT = process.cwd();
const STRICT = process.argv.includes("--strict");
const FULL_SHA = /^[0-9a-f]{40}$/i;

async function readText(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

function command(args) {
  try {
    return { exitCode: 0, stdout: execFileSync(args[0], args.slice(1), { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { exitCode: typeof error.status === "number" ? error.status : 1, stdout: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const packageJson = JSON.parse((await readText("package.json")) ?? "{}");
const appJson = JSON.parse((await readText("apps/my-pi-mcp/package.json")) ?? "{}");
const headResult = command(["git", "rev-parse", "HEAD"]);
const head = headResult.stdout.trim();
const status = command(["git", "status", "--porcelain"]);
const baselineText = await readText("docs/production-next/BASELINE.md");
const baseline = baselineText?.match(/Baseline SHA:\s*`([0-9a-f]{40})`/i)?.[1];
const baselineAncestry = baseline && FULL_SHA.test(head) ? command(["git", "merge-base", "--is-ancestor", baseline, head]) : { exitCode: 1, stdout: "" };
const schemaText = await readText("packages/contracts/src/schema-version.ts");
const coordinationMigrationText = await readText("packages/coordination-store/src/migrations.ts");
const evaluationText = await readText("packages/evaluation-runtime/src/index.ts");
const coordinationText = await readText("packages/coordination-runtime/src/index.ts");

const requiredPaths = [
  "docs/production-next/BASELINE.md",
  "docs/production-next/IMPLEMENTATION_STATUS.md",
  "docs/production-next/OBSERVED_EVIDENCE.md",
  "dogfood/project.yaml",
  "fixtures/impact-routing/corpus.json",
  "fixtures/evaluation-feedback/corpus.json",
  "evidence/PN6.json",
  "evidence/PN8.json",
  "evidence/PN9.json",
  "evidence/PN12.json",
  "provenance/production-next-protocol-matrix.json",
  "scripts/candidate-state.mjs",
  "scripts/verify-production-next-evidence.mjs",
  "scripts/verify-production-next-promotion.mjs",
  "scripts/create-production-next-manifest.mjs",
  "schemas/production-next-evidence.schema.json",
  "benchmarks/impact-routing-arms.mjs",
  "benchmarks/evaluation-feedback-arms.mjs",
  "benchmarks/local-reliability.mjs",
  "benchmarks/coordination-latency.mjs",
  "benchmarks/coordination-contention.mjs",
  "benchmarks/context-routing.mjs",
  "benchmarks/code-state-index.mjs",
  "benchmarks/code-state-incremental.mjs",
  "benchmarks/evaluation-throughput.mjs",
  "benchmarks/feedback-loop.mjs",
];
const pathChecks = await Promise.all(requiredPaths.map(async (relativePath) => ({ path: relativePath, present: (await readText(relativePath)) !== undefined })));
const missing = pathChecks.filter((check) => !check.present).map((check) => check.path);
const release = command([process.execPath, "scripts/verify-release.mjs", "--strict"]);
const pn9Evidence = command([process.execPath, "scripts/verify-production-next-evidence.mjs"]);
const promotion = command([process.execPath, "scripts/verify-production-next-promotion.mjs"]);
const baselineReport = baselineAssessment({ baseline, head, ancestorExitCode: baselineAncestry.exitCode, candidateDirty: status.stdout.trim().length > 0 });
const report = {
  schemaVersion: 1,
  status: "WITHHELD",
  candidate: {
    head: FULL_SHA.test(head) ? head : null,
    dirty: status.stdout.trim().length > 0,
    packageVersion: packageJson.version ?? null,
    appVersion: appJson.version ?? null,
  },
  baseline: baselineReport,
  versions: {
    coordinationSchema: schemaText?.match(/CURRENT_SCHEMA_VERSION:\s*SchemaVersion\s*=\s*"([^"]+)"/)?.[1] ?? null,
    coordinationStoreMigration: coordinationMigrationText?.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1] ?? null,
    evaluationRuntimePresent: evaluationText !== undefined,
    coordinationRuntimePresent: coordinationText !== undefined,
  },
  requiredArtifacts: { missing, complete: missing.length === 0 },
  productionNextEvidence: { exitCode: pn9Evidence.exitCode, pass: pn9Evidence.exitCode === 0, outputTail: pn9Evidence.stdout.slice(-2000) },
  promotionGate: { exitCode: promotion.exitCode, pass: promotion.exitCode === 0, outputTail: promotion.stdout.slice(-2000) },
  gates: {
    PN6: pn9Evidence.exitCode === 0 ? "WITHHELD_EXTERNAL_PRODUCT_OUTCOME" : "WITHHELD_REPRESENTATIVE_PRODUCT_EVIDENCE",
    PN8: pn9Evidence.exitCode === 0 ? "WITHHELD_EXTERNAL_REPAIR_OUTCOME" : "WITHHELD_REPAIR_YIELD_EVIDENCE",
    PN9: pn9Evidence.exitCode === 0 ? "WITHHELD_STABLE_N_MINUS_1_PROMOTION" : "WITHHELD_SELF_HOST_EVIDENCE",
    PN12: pn9Evidence.exitCode === 0 ? "CANDIDATE_LOCAL_FAULT_EVIDENCE" : "WITHHELD_LOCAL_FAULT_EVIDENCE",
    PN11: promotion.exitCode === 0 ? "CANDIDATE_ENTRY_READY" : "WITHHELD_ENTRY_CONDITION",
    PN13: "WITHHELD_CANDIDATE_ADMISSION",
  },
  releaseVerifier: { exitCode: release.exitCode, pass: release.exitCode === 0, outputTail: release.stdout.slice(-2000) },
};
console.log(JSON.stringify(report, null, 2));
if (STRICT && (missing.length > 0 || !report.baseline.isAncestor || !report.releaseVerifier.pass || !report.productionNextEvidence.pass || !report.promotionGate.pass)) process.exitCode = 1;
