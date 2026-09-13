import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateObservedPair } from "./validate-observed-task-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_ID = /^OT-[0-9]{3,}$/;
const HYPOTHESES = ["PN6", "PN8"];

function parseArgs(argv) {
  const values = { root: ROOT, minQualified: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--root", "--tasks-root", "--output", "--min-qualified"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      values[arg.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/aggregate-observed-evidence-v2.mjs [--tasks-root <dir>] [--output <file>] [--min-qualified <n>]");
      return undefined;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  const minQualified = Number(values.minQualified);
  if (!Number.isInteger(minQualified) || minQualified < 1 || minQualified > 1000) throw new Error("--min-qualified must be an integer between 1 and 1000");
  return { ...values, minQualified };
}

function relativeInside(root, candidate, label) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the repository`);
  return absolute;
}

function metricKey(metric) {
  return `${metric.armId}\0${metric.id}`;
}

function mean(values) {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assessPair(task, result) {
  const validation = validateObservedPair(task, result);
  const reasons = [...validation.errors];
  const measurements = Array.isArray(result.measurements) ? result.measurements : [];
  const requiredMetricIds = new Set((task.metrics ?? []).map((metric) => metric.id));
  const observedMeasurementKeys = new Set(measurements.map(metricKey));
  for (const metricId of requiredMetricIds) {
    for (const armId of ["control", "treatment"]) {
      if (!observedMeasurementKeys.has(`${armId}\0${metricId}`)) reasons.push(`missing measurement ${armId}/${metricId}`);
    }
  }
  const commandsPassed = result.arms?.every((arm) => arm.commands?.every((command) => command.status === "passed")) === true;
  if (!commandsPassed) reasons.push("a predeclared command did not pass in every arm");
  if (result.status !== "COMPLETED") reasons.push(`result status is ${result.status}`);
  if (result.adjudication?.independent !== true) reasons.push("independent adjudication is required");
  if (result.adjudication?.outcome !== "accepted") reasons.push(`adjudication outcome is ${result.adjudication?.outcome ?? "missing"}`);
  if (result.arms?.some((arm) => arm.contamination?.detected === true)) reasons.push("contamination was detected");

  const eligible = validation.ok && reasons.length === 0 && task.taskClass === task.primaryHypothesis && HYPOTHESES.includes(task.primaryHypothesis);
  const metrics = Object.fromEntries((task.metrics ?? []).map((metric) => {
    const control = measurements.find((observed) => observed.id === metric.id && observed.armId === "control")?.value;
    const treatment = measurements.find((observed) => observed.id === metric.id && observed.armId === "treatment")?.value;
    return [metric.id, { control, treatment, delta: control === undefined || treatment === undefined ? undefined : treatment - control }];
  }));
  return {
    taskId: task.taskId,
    taskClass: task.taskClass,
    primaryHypothesis: task.primaryHypothesis,
    resultStatus: result.status,
    runCompletedAt: result.runCompletedAt,
    validPair: validation.ok,
    qualified: eligible,
    reasons,
    independentAdjudication: result.adjudication?.independent === true,
    measurements: metrics,
    runIds: result.arms?.map((arm) => arm.runId) ?? [],
    evaluatorRunId: result.adjudication?.evaluatorRunId,
  };
}

function aggregateMetricReports(pairReports) {
  const grouped = new Map();
  for (const pair of pairReports.filter((item) => item.qualified)) {
    for (const [id, measurement] of Object.entries(pair.measurements)) {
      if (measurement.control === undefined || measurement.treatment === undefined) continue;
      const values = grouped.get(id) ?? { control: [], treatment: [], delta: [] };
      values.control.push(measurement.control);
      values.treatment.push(measurement.treatment);
      values.delta.push(measurement.delta);
      grouped.set(id, values);
    }
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, values]) => [id, {
    observations: values.delta.length,
    meanControl: mean(values.control),
    meanTreatment: mean(values.treatment),
    meanDelta: mean(values.delta),
  }]));
}

export function aggregateObservedEvidence(pairs, { minQualified = 3, generatedAt } = {}) {
  const pairReports = pairs.map(({ task, result }) => assessPair(task, result)).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const byHypothesis = Object.fromEntries(HYPOTHESES.map((hypothesis) => {
    const records = pairReports.filter((pair) => pair.primaryHypothesis === hypothesis);
    const qualified = records.filter((pair) => pair.qualified);
    return [hypothesis, {
      registered: records.length,
      qualified: qualified.length,
      target: minQualified,
      targetMet: qualified.length >= minQualified,
      taskIds: qualified.map((pair) => pair.taskId),
    }];
  }));
  const targetMet = HYPOTHESES.every((hypothesis) => byHypothesis[hypothesis].targetMet);
  const reasons = [];
  if (!targetMet) reasons.push("predeclared sample target is not met for every hypothesis");
  if (pairReports.some((pair) => !pair.validPair)) reasons.push("one or more pairs failed schema or identity validation");
  reasons.push("candidate aggregate is not an admission authority");
  return {
    schemaVersion: "1",
    recordType: "observed-evidence-aggregate-v2",
    generatedAt: generatedAt ?? pairReports.map((pair) => pair.resultCompletedAt).filter(Boolean).sort().at(-1) ?? null,
    status: "WITHHELD",
    promotionEligible: false,
    promotionVerdict: targetMet ? "candidate_only_requires_independent_promotion_verifier" : "withheld_sample_or_pair_requirements",
    reasons,
    sample: { minQualifiedPerHypothesis: minQualified, totalPairs: pairReports.length, qualifiedPairs: pairReports.filter((pair) => pair.qualified).length, byHypothesis },
    metrics: aggregateMetricReports(pairReports),
    pairs: pairReports,
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadObservedPairs(tasksRoot) {
  const entries = (await readdir(tasksRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^OT-[0-9]{3,}\.json$/.test(entry.name))
    .map((entry) => entry.name.slice(0, -5))
    .filter((taskId) => TASK_ID.test(taskId))
    .sort();
  const pairs = [];
  for (const taskId of entries) {
    const taskPath = path.join(tasksRoot, `${taskId}.json`);
    const resultPath = path.join(tasksRoot, `${taskId}.result.json`);
    try {
      pairs.push({ task: await readJson(taskPath), result: await readJson(resultPath) });
    } catch (error) {
      pairs.push({
        task: { taskId, taskClass: "research", primaryHypothesis: "none", metrics: [] },
        result: { status: "INCONCLUSIVE", measurements: [], arms: [], adjudication: { independent: false } },
        loadError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return pairs;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const root = path.resolve(args.root);
  const tasksRoot = relativeInside(root, args.tasks_root ?? path.join("dogfood", "observed-tasks"), "--tasks-root");
  const output = relativeInside(root, args.output ?? path.join("evidence", "observed-evidence-v2.aggregate.json"), "--output");
  const pairs = await loadObservedPairs(tasksRoot);
  const report = aggregateObservedEvidence(pairs, { minQualified: args.minQualified });
  const loadErrors = pairs.filter((pair) => pair.loadError).map((pair) => ({ taskId: pair.task.taskId, error: pair.loadError }));
  if (loadErrors.length > 0) report.reasons.push(`${loadErrors.length} pair file(s) could not be loaded`);
  report.loadErrors = loadErrors;
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output, status: report.status, promotionEligible: report.promotionEligible, qualifiedPairs: report.sample.qualifiedPairs }, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
