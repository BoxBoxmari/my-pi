#!/usr/bin/env node
/**
 * PN6 controlled replay across the five labelled coordination workload classes.
 * The repair model is deliberately explicit: a missed labelled dependency costs
 * one additional repair iteration. It is a qualification signal, not a field
 * observation or a release claim.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ImpactEngine } from "../packages/impact-engine/dist/index.js";
import { candidateCommit, candidateDirty, candidateDirtyPaths, candidateStateDigest } from "../scripts/candidate-state.mjs";

const ROOT = path.resolve(".");
const CORPUS_ROOT = path.join(ROOT, "benchmarks", "corpora", "coordination");
const OBSERVED_AT = "2026-09-04T00:00:00.000Z";

async function loadScenarios() {
  const directories = (await readdir(CORPUS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(directories.map((directory) => readFile(path.join(CORPUS_ROOT, directory, "scenario.json"), "utf8").then((text) => JSON.parse(text))));
}

function materialize(scenario) {
  const entities = scenario.entities.map((entity) => ({
    ...entity,
    projectId: "project-pn6",
    repositoryId: "repo-pn6",
    worktreeId: "worktree-pn6",
    observedAt: OBSERVED_AT,
    provider: entity.kind === "test" ? "ast" : "ast",
  }));
  const edges = scenario.edges.map((edge) => ({ ...edge, provider: "ast", observedAt: OBSERVED_AT }));
  const workItems = scenario.workItems.map((item) => ({
    ...item,
    projectId: "project-pn6",
    state: "active",
    version: 1,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  }));
  const intents = scenario.intents.map((intent) => ({ ...intent, projectId: "project-pn6", state: "active", createdAt: OBSERVED_AT }));
  const dependencies = scenario.dependencies.map((dependency) => ({ ...dependency }));
  return { entities, edges, workItems, intents, dependencies };
}

function entityIdsConnectedToTarget(scenario, materialized) {
  const targetIds = new Set(materialized.entities.filter((entity) => entity.path === scenario.targetPath).map((entity) => entity.id));
  const connected = new Set(targetIds);
  const queue = [...targetIds];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of materialized.edges) {
      if (!["exact", "strong", "medium", "weak"].includes(edge.confidence)) continue;
      if (edge.from !== current && edge.to !== current) continue;
      const next = edge.from === current ? edge.to : edge.from;
      if (connected.has(next)) continue;
      connected.add(next);
      queue.push(next);
    }
  }
  return connected;
}

function sourceWorkItem(scenario) {
  return scenario.workItems.find((item) => item.id === "work-source")?.id ?? scenario.workItems[0]?.id;
}

function simpleTaskBoardRoute(scenario) {
  const source = sourceWorkItem(scenario);
  const route = new Set(source ? [source] : []);
  for (const dependency of scenario.dependencies) {
    if (dependency.from === source) route.add(dependency.to);
    if (dependency.to === source) route.add(dependency.from);
  }
  return route;
}

function passiveGraphRoute(scenario, materialized) {
  const connected = entityIdsConnectedToTarget(scenario, materialized);
  const route = new Set(sourceWorkItem(scenario) ? [sourceWorkItem(scenario)] : []);
  for (const intent of materialized.intents) {
    const targetPaths = new Set(intent.targets.flatMap((target) => target.type === "path" ? [target.value] : []));
    if (materialized.entities.some((entity) => connected.has(entity.id) && targetPaths.has(entity.path))) route.add(intent.workItemId);
  }
  return route;
}

function fullImpactRoute(scenario, materialized, engine) {
  const sourceIntent = materialized.intents.find((intent) => intent.workItemId === sourceWorkItem(scenario));
  const result = engine.compute({
    subject: sourceIntent.id,
    intent: sourceIntent,
    entities: materialized.entities,
    edges: materialized.edges,
    workItems: materialized.workItems,
    dependencies: materialized.dependencies,
    activeIntents: materialized.intents,
  });
  return { route: new Set(result.affectedWorkItems.map((item) => item.workItemId)), result };
}

function metrics(predicted, expected) {
  const tp = [...predicted].filter((id) => expected.has(id)).length;
  const fp = [...predicted].filter((id) => !expected.has(id)).length;
  const fn = [...expected].filter((id) => !predicted.has(id)).length;
  return {
    precision: tp + fp === 0 ? 1 : Number((tp / (tp + fp)).toFixed(3)),
    recall: tp + fn === 0 ? 1 : Number((tp / (tp + fn)).toFixed(3)),
    falsePositiveRate: predicted.size === 0 ? 0 : Number((fp / predicted.size).toFixed(3)),
    missedDependencyRate: expected.size <= 1 ? 0 : Number((fn / (expected.size - 1)).toFixed(3)),
    tp,
    fp,
    fn,
  };
}

function outcome(predicted, expected, sourceId) {
  const missedDownstream = [...expected].filter((id) => id !== sourceId && !predicted.has(id));
  return {
    integrationRepairIterations: missedDownstream.length === 0 ? 1 : 1 + missedDownstream.length,
    staleContractMistakes: missedDownstream.length,
    missedDownstream,
  };
}

const started = performance.now();
const scenarios = await loadScenarios();
const engine = new ImpactEngine();
const armNames = ["worktreesOnly", "taskBoardOnly", "passiveGraphMemory", "coordinationNoImpact", "fullImpactRouting"];
const armResults = Object.fromEntries(armNames.map((name) => [name, { predictions: 0, expected: 0, metrics: { tp: 0, fp: 0, fn: 0 }, integrationRepairIterations: 0, staleContractMistakes: 0, estimatedContextBytes: 0, cases: [] }]));

for (const scenario of scenarios) {
  const materialized = materialize(scenario);
  const expected = new Set(scenario.expectedAffectedWorkItems);
  const sourceId = sourceWorkItem(scenario);
  const full = fullImpactRoute(scenario, materialized, engine);
  const routes = {
    worktreesOnly: new Set(sourceId ? [sourceId] : []),
    taskBoardOnly: simpleTaskBoardRoute(scenario),
    passiveGraphMemory: passiveGraphRoute(scenario, materialized),
    coordinationNoImpact: simpleTaskBoardRoute(scenario),
    fullImpactRouting: full.route,
  };
  for (const armName of armNames) {
    const predicted = routes[armName];
    const arm = armResults[armName];
    const armMetrics = metrics(predicted, expected);
    const armOutcome = outcome(predicted, expected, sourceId);
    arm.predictions += predicted.size;
    arm.expected += expected.size;
    arm.metrics.tp += armMetrics.tp;
    arm.metrics.fp += armMetrics.fp;
    arm.metrics.fn += armMetrics.fn;
    arm.integrationRepairIterations += armOutcome.integrationRepairIterations;
    arm.staleContractMistakes += armOutcome.staleContractMistakes;
    arm.estimatedContextBytes += Buffer.byteLength(JSON.stringify([...predicted].sort()), "utf8");
    arm.cases.push({ id: scenario.id, predicted: [...predicted].sort(), expected: [...expected].sort(), ...armMetrics, ...armOutcome, impactReasons: armName === "fullImpactRouting" ? full.result.reasons : [] });
  }
}

const arms = {};
for (const armName of armNames) {
  const value = armResults[armName];
  const total = value.metrics;
  const caseCount = scenarios.length;
  arms[armName] = {
    caseCount,
    routedItems: value.predictions,
    precision: total.tp + total.fp === 0 ? 1 : Number((total.tp / (total.tp + total.fp)).toFixed(3)),
    recall: total.tp + total.fn === 0 ? 1 : Number((total.tp / (total.tp + total.fn)).toFixed(3)),
    falsePositiveRate: value.predictions === 0 ? 0 : Number((total.fp / value.predictions).toFixed(3)),
    missedDependencyRate: value.expected <= caseCount ? 0 : Number((total.fn / (value.expected - caseCount)).toFixed(3)),
    integrationRepairIterations: value.integrationRepairIterations,
    averageRepairIterations: Number((value.integrationRepairIterations / caseCount).toFixed(3)),
    staleContractMistakes: value.staleContractMistakes,
    estimatedContextBytes: value.estimatedContextBytes,
    caseResults: value.cases,
  };
}

const baseline = arms.taskBoardOnly;
const full = arms.fullImpactRouting;
const report = {
  profile: "impact-routing-arms",
  evidenceKind: "controlled_replay",
  productGate: full.averageRepairIterations < baseline.averageRepairIterations && full.recall >= baseline.recall ? "CANDIDATE_VALUE_SIGNAL" : "WITHHELD_NO_VALUE_SIGNAL",
  cases: scenarios.length,
  scenarioIds: scenarios.map((scenario) => scenario.id),
  arms,
  comparison: {
    simplerBaseline: "taskBoardOnly",
    fullRepairReduction: Number((baseline.averageRepairIterations - full.averageRepairIterations).toFixed(3)),
    fullStaleContractMistakeReduction: baseline.staleContractMistakes - full.staleContractMistakes,
  },
  elapsedMs: Number((performance.now() - started).toFixed(3)),
};

const evidenceOutArg = process.argv.indexOf("--evidence-out");
const evidenceOut = evidenceOutArg < 0 ? undefined : process.argv[evidenceOutArg + 1];
if (evidenceOutArg >= 0 && !evidenceOut) throw new Error("--evidence-out requires a path");
if (evidenceOut === undefined) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const outputPath = path.resolve(ROOT, evidenceOut);
  const relative = path.relative(ROOT, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--evidence-out must stay inside the repository");
  const commit = candidateCommit();
  const dirty = candidateDirty();
  const evidence = { schemaVersion: "1", id: "PN6", profile: report.profile, status: "CANDIDATE", evidenceKind: report.evidenceKind, commit, candidateSha: dirty ? "uncommitted" : commit, candidateDirty: dirty, candidateStateDigest: await candidateStateDigest(), promotionEligible: false, report };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ profile: report.profile, evidencePath: relative.replaceAll(path.sep, "/"), candidateSha: evidence.candidateSha, candidateDirty: evidence.candidateDirty, ...(dirty ? { dirtyPaths: candidateDirtyPaths() } : {}), productGate: report.productGate }, null, 2));
}
