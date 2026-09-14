import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateObservedPair } from "./validate-observed-task-v2.mjs";
import { verifyObservedPairRegistration } from "./observed-registration-v2.mjs";

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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function measurementValue(result, id, armId) {
  return result.measurements?.find((measurement) => measurement.id === id && measurement.armId === armId)?.value;
}

function evidenceGate(task, result) {
  const errors = [];
  const workload = task.workload ?? {};
  const hypothesis = task.primaryHypothesis;
  const heterogeneityKey = typeof workload.heterogeneityKey === "string" && workload.heterogeneityKey.length > 0 ? workload.heterogeneityKey : undefined;
  if (!heterogeneityKey) errors.push(hypothesis + " requires a predeclared heterogeneityKey");
  if (hypothesis === "PN6") {
    if (workload.evidenceKind !== "observed_source_change") errors.push("PN6 requires observed_source_change evidence");
    if (result.evidenceKind !== "observed_source_change") errors.push("PN6 result must identify observed_source_change evidence");
    const armRuns = result.measurementEvidence?.armRuns;
    if (result.measurementEvidence?.evaluatorMode !== "independent-command-output" || armRuns === undefined) errors.push("PN6 repair metrics require independent command-output evidence");
    for (const armId of ["control", "treatment"]) {
      const arm = result.arms?.find((candidate) => candidate.armId === armId);
      const row = armRuns?.[armId];
      if (!row || row.runId !== arm?.runId || row.evaluatorRunId !== result.adjudication?.evaluatorRunId) {
        errors.push("PN6 measurement evidence must bind each arm to its independent evaluator run");
        continue;
      }
      if (!isNonNegativeInteger(row.repairIterations)) errors.push("PN6 repairIterations must be a measured non-negative integer");
      if (typeof row.accepted !== "boolean") errors.push("PN6 arm acceptance must be independently recorded");
      if (measurementValue(result, "repair_iterations", armId) !== row.repairIterations) errors.push("PN6 repair_iterations measurement does not match evaluator evidence");
      if (measurementValue(result, "downstream_pass", armId) !== (row.accepted ? 1 : 0)) errors.push("PN6 downstream_pass measurement does not match evaluator evidence");
    }
  } else if (hypothesis === "PN8") {
    if (workload.evidenceKind !== "live_repair") errors.push("PN8 requires live_repair evidence; controlled replay is diagnostic only");
    if (result.evidenceKind !== "live_repair") errors.push("PN8 result must identify live_repair evidence");
    const sessions = result.repairSessions;
    if (!Array.isArray(sessions) || sessions.length !== 2) {
      errors.push("PN8 requires two independent repair sessions");
    } else {
      const byArm = new Map(sessions.map((session) => [session.armId, session]));
      const digests = new Set(sessions.map((session) => session.frozenStateDigest));
      if (digests.size !== 1 || [...digests][0] === undefined) errors.push("PN8 arms must start from the same frozen failing state");
      if (new Set(sessions.map((session) => session.sessionId)).size !== 2 || new Set(sessions.map((session) => session.worktreeId)).size !== 2) errors.push("PN8 repair sessions must have distinct session and worktree identities");
      for (const [armId, mode] of [["control", "ordinary_log"], ["treatment", "structured_feedback_packet"]]) {
        const session = byArm.get(armId);
        if (!session || session.feedbackMode !== mode) errors.push("PN8 control/treatment feedback modes are not independently bound");
        if (!session || !isNonNegativeInteger(session.attempts) || session.attempts < 1) errors.push("PN8 attempts must be measured as a positive integer");
        if (!session || session.accepted !== true) errors.push("PN8 requires accepted repair outcomes in both arms");
        if (!session || session.priorPassesPreserved !== true) errors.push("PN8 prior passes must be independently preserved");
        if (!session || session.regressions !== 0 || session.falseAccepts !== 0) errors.push("PN8 regressions and false accepts must both be zero");
      }
    }
  }
  return { errors, heterogeneityKey };
}
function assessPair(task, result, registration) {
  const validation = validateObservedPair(task, result);
  const reasons = [...validation.errors];
  const registrationValid = registration?.ok === true;
  if (!registrationValid) reasons.push(...(registration?.errors ?? ["Git registration verification is required"]));
  const evidence = evidenceGate(task, result);
  reasons.push(...evidence.errors);
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

  const eligible = validation.ok && registrationValid && evidence.errors.length === 0 && reasons.length === 0 && task.taskClass === task.primaryHypothesis && HYPOTHESES.includes(task.primaryHypothesis);
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
    validPair: validation.ok && registrationValid,
    registration: registration ?? { ok: false, errors: ["Git registration verification is required"] },
    heterogeneityKey: evidence.heterogeneityKey,
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
  const pairReports = pairs.map(({ task, result, registration }) => assessPair(task, result, registration)).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const byHypothesis = Object.fromEntries(HYPOTHESES.map((hypothesis) => {
    const records = pairReports.filter((pair) => pair.primaryHypothesis === hypothesis);
    const qualified = records.filter((pair) => pair.qualified);
    return [hypothesis, {
      registered: records.length,
      qualified: qualified.length,
      target: minQualified,
      heterogeneityKeys: [...new Set(qualified.map((pair) => pair.heterogeneityKey).filter(Boolean))],
      heterogeneous: new Set(qualified.map((pair) => pair.heterogeneityKey).filter(Boolean)).size >= minQualified,
      targetMet: qualified.length >= minQualified && new Set(qualified.map((pair) => pair.heterogeneityKey).filter(Boolean)).size >= minQualified,
      taskIds: qualified.map((pair) => pair.taskId),
    }];
  }));
  const targetMet = HYPOTHESES.every((hypothesis) => byHypothesis[hypothesis].targetMet);
  const reasons = [];
  if (!targetMet) reasons.push("predeclared sample target and heterogeneous-task requirement are not met for every hypothesis");
  if (pairReports.some((pair) => !pair.validPair)) reasons.push("one or more pairs failed schema or identity validation");
  reasons.push("candidate aggregate is not an admission authority");
  return {
    schemaVersion: "1",
    recordType: "observed-evidence-aggregate-v2",
    generatedAt: generatedAt ?? pairReports.map((pair) => pair.runCompletedAt).filter(Boolean).sort().at(-1) ?? null,
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

export async function loadObservedPairs(tasksRoot, { root = path.resolve(tasksRoot, "..", "..") } = {}) {
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
      const task = await readJson(taskPath);
      const result = await readJson(resultPath);
      const registration = await verifyObservedPairRegistration(root, task, result);
      pairs.push({ task, result, registration });
    } catch (error) {
      pairs.push({
        task: { taskId, taskClass: "research", primaryHypothesis: "none", metrics: [] },
        result: { status: "INCONCLUSIVE", measurements: [], arms: [], adjudication: { independent: false } },
        registration: { ok: false, errors: [error instanceof Error ? error.message : String(error)] },
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
  const pairs = await loadObservedPairs(tasksRoot, { root });
  const report = aggregateObservedEvidence(pairs, { minQualified: args.minQualified });
  const loadErrors = pairs.filter((pair) => pair.loadError).map((pair) => ({ taskId: pair.task.taskId, error: pair.loadError }));
  if (loadErrors.length > 0) report.reasons.push(`${loadErrors.length} pair file(s) could not be loaded`);
  report.loadErrors = loadErrors;
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output, status: report.status, promotionEligible: report.promotionEligible, qualifiedPairs: report.sample.qualifiedPairs }, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
