import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HYPOTHESES = ["PN6", "PN8"];

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function verifyObservedAggregate(report, { minQualified = 3 } = {}) {
  const errors = [];
  add(errors, report !== null && typeof report === "object" && !Array.isArray(report), "aggregate must be an object");
  if (errors.length > 0) return { ok: false, errors, admission: "WITHHELD", promotionEligible: false };
  add(errors, report.schemaVersion === "1", "schemaVersion must be 1");
  add(errors, report.recordType === "observed-evidence-aggregate-v2", "recordType must be observed-evidence-aggregate-v2");
  add(errors, report.status === "WITHHELD", "aggregate status must remain WITHHELD");
  add(errors, report.promotionEligible === false, "aggregate cannot self-promote");
  add(errors, Array.isArray(report.pairs), "pairs must be an array");
  add(errors, report.sample !== null && typeof report.sample === "object", "sample must be an object");
  if (report.sample && typeof report.sample === "object") {
    add(errors, report.sample.minQualifiedPerHypothesis === minQualified, "sample target does not match the verifier target");
    for (const hypothesis of HYPOTHESES) {
      const sample = report.sample.byHypothesis?.[hypothesis];
      add(errors, sample !== null && typeof sample === "object", `${hypothesis} sample is missing`);
      if (sample && typeof sample === "object") {
        add(errors, Number.isInteger(sample.qualified) && sample.qualified >= 0, `${hypothesis}.qualified must be a non-negative integer`);
        add(errors, sample.qualified <= sample.registered, `${hypothesis}.qualified cannot exceed registered`);
      }
    }
  }
  for (const pair of Array.isArray(report.pairs) ? report.pairs : []) {
    const runIds = Array.isArray(pair.runIds) ? pair.runIds : [];
    add(errors, new Set(runIds).size === runIds.length, `${pair.taskId ?? "pair"} has duplicate arm run ids`);
    if (pair.qualified === true) {
      add(errors, pair.validPair === true, `${pair.taskId ?? "pair"} cannot be qualified when validPair is false`);
      add(errors, HYPOTHESES.includes(pair.primaryHypothesis), `${pair.taskId ?? "pair"} has an unsupported hypothesis`);
      add(errors, runIds.length === 2, `${pair.taskId ?? "pair"} must retain both arm run ids`);
      add(errors, typeof pair.evaluatorRunId === "string" && !runIds.includes(pair.evaluatorRunId), `${pair.taskId ?? "pair"} evaluator must be independent from arm runs`);
    }
  }
  return { ok: errors.length === 0, errors, admission: "WITHHELD", promotionEligible: false };
}

async function main(argv = process.argv.slice(2)) {
  const reportPath = argv[0] ? path.resolve(ROOT, argv[0]) : path.join(ROOT, "evidence", "observed-evidence-v2.aggregate.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const verification = verifyObservedAggregate(report);
  console.log(JSON.stringify({ ...verification, report: reportPath }, null, 2));
  if (!verification.ok) process.exitCode = 1;
  return verification.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
