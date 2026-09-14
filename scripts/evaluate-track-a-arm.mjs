#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = process.cwd();

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task") {
      const value = argv[index + 1];
      if (!value) throw new Error("--task requires a value");
      values.task = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/evaluate-track-a-arm.mjs --task <task.json>");
      return undefined;
    } else throw new Error("unknown argument: " + arg);
  }
  if (!values.task) throw new Error("--task is required");
  return values;
}

function importFromRoot(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

function routeMetrics(selected, groundTruth) {
  const selectedSet = new Set(selected);
  const expectedSet = new Set(groundTruth);
  const tp = [...selectedSet].filter((value) => expectedSet.has(value)).length;
  const fp = [...selectedSet].filter((value) => !expectedSet.has(value)).length;
  const fn = [...expectedSet].filter((value) => !selectedSet.has(value)).length;
  return {
    routing_recall: expectedSet.size === 0 ? 1 : Number((tp / expectedSet.size).toFixed(3)),
    routing_precision: selectedSet.size === 0 ? 1 : Number((tp / selectedSet.size).toFixed(3)),
    selected_items: selectedSet.size,
    false_positive_items: fp,
    missed_items: fn,
  };
}


function sha256Text(value) {
  return "sha256:" + createHash("sha256").update(value.replaceAll("\r\n", "\n"), "utf8").digest("hex");
}

function unwrapMyPi(result) {
  if (result.isError) throw new Error(result.content?.map((item) => item.text ?? "").join("\n") || "my-pi tool failed");
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("my-pi tool returned no text content");
  const envelope = JSON.parse(text);
  if (envelope.error) throw new Error(envelope.error.message ?? JSON.stringify(envelope.error));
  return envelope.data ?? envelope;
}

async function connectMyPiEvaluator() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps/my-pi-mcp", "dist", "main.js"), "--workspace", ROOT, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "my-pi-independent-pn6-evaluator", version: "1" });
  await client.connect(transport);
  return client;
}

async function callMyPi(client, name, args) {
  return unwrapMyPi(await client.callTool({ name, arguments: args }));
}

async function inspectSourceCheck(check) {
  const content = await readFile(path.resolve(ROOT, check.path), "utf8");
  const digest = sha256Text(content);
  const includes = Array.isArray(check.includes) ? check.includes.every((value) => content.includes(value)) : true;
  const excludes = Array.isArray(check.excludes) ? check.excludes.every((value) => !content.includes(value)) : true;
  const hashMatches = check.expectedHash === undefined || check.expectedHash === digest;
  return { path: check.path, digest, includes, excludes, hashMatches, passed: includes && excludes && hashMatches };
}

function inspectRoute(marker, required) {
  const selected = Array.isArray(marker.route) ? marker.route : [];
  const selectedSet = new Set(selected);
  const missing = (required ?? []).filter((item) => !selectedSet.has(item));
  return { required: [...(required ?? [])], selected, missing, passed: missing.length === 0 };
}

async function applyEvaluatorPatches(client, patches) {
  const history = [];
  for (const patch of patches) {
    const before = await callMyPi(client, "fs_read", { path: patch.path, start_line: 1, end_line: 200_000 });
    let oldText = patch.old;
    let newText = patch.new;
    let lineEndingMode = "lf";
    if (!before.content.includes(oldText) && before.content.includes(oldText.replaceAll("\n", "\r\n"))) {
      oldText = oldText.replaceAll("\n", "\r\n");
      newText = newText.replaceAll("\n", "\r\n");
      lineEndingMode = "crlf";
    }
    if (!before.content.includes(oldText)) throw new Error("PN6 repair patch anchor not found: " + patch.id);
    const patched = await callMyPi(client, "fs_patch", { path: patch.path, expected_hash: before.content_hash, patch: { hunks: [{ old: oldText, new: newText }] } });
    const after = await callMyPi(client, "fs_read", { path: patch.path, start_line: 1, end_line: 200_000 });
    if (patch.expectedAfterHash && after.content_hash !== patch.expectedAfterHash) throw new Error("PN6 repair patch produced an unexpected hash: " + patch.id);
    history.push({ id: patch.id, path: patch.path, lineEndingMode, sourceBefore: before.content_hash, sourceAfter: after.content_hash, patchResponseHash: patched.content_hash, mutationTool: "official my-pi fs_patch", casExpectedHash: before.content_hash });
  }
  return history;
}

async function evaluateMeasuredSourceRepair(task, marker) {
  const workload = task.workload ?? {};
  const evaluator = workload.evaluator;
  if (!evaluator || evaluator.kind !== "measured_source_repair") throw new Error("PN6 measured evaluator is not predeclared");
  const routeRequirement = evaluator.routeRequirements?.[marker.arm] ?? [];
  const evaluateAttempt = async (stage) => {
    const sourceCheck = await inspectSourceCheck(evaluator.sourceChecks[marker.arm]);
    const routeCheck = inspectRoute(marker, routeRequirement);
    return { stage, sourceCheck, routeCheck, passed: sourceCheck.passed && routeCheck.passed };
  };
  const attempts = [await evaluateAttempt("initial")];
  let repairHistory = [];
  if (!attempts[0].passed) {
    const repairPatches = evaluator.repairPatches?.[marker.arm] ?? [];
    if (repairPatches.length > 0) {
      const client = await connectMyPiEvaluator();
      try { repairHistory = await applyEvaluatorPatches(client, repairPatches); } finally { await client.close(); }
      attempts.push(await evaluateAttempt("after_repair"));
    }
  }
  const finalAttempt = attempts.at(-1);
  const sourceChangeExpected = workload.mutationMode === "shared_source_change" ? true : marker.arm === "treatment";
  const sourceChangeObserved = marker.sourceAfter !== marker.sourceBefore;
  const repairIterations = attempts.length - 1;
  const accepted = finalAttempt?.passed === true && marker.taskId === task.taskId && sourceChangeObserved === sourceChangeExpected;
  return {
    schemaVersion: "my-pi/track-a-evaluator/v3",
    taskId: task.taskId,
    arm: marker.arm,
    accepted,
    evaluator: "independent node process with official my-pi repair patches",
    evidenceKind: "observed_source_change",
    sourceChangeExpected,
    sourceChangeObserved,
    groundTruth: marker.groundTruth,
    selected: marker.route,
    metrics: { ...routeMetrics(marker.route, marker.groundTruth), downstream_pass: accepted ? 1 : 0, repair_iterations: repairIterations },
    measurementGaps: [],
    repairTrace: { attempts, repairIterations, repairHistory },
    assertion: { passed: accepted, finalAttempt },
  };
}

async function evaluateControlledReplay(task, marker) {
  const workload = task.workload ?? {};
  const replayPatches = workload.failureReplay?.patches;
  const repairPatches = workload.repairPatches?.[marker.arm] ?? workload.repairPatches?.shared;
  if (!Array.isArray(replayPatches) || !Array.isArray(repairPatches)) throw new Error("PN8 workload patch plan is incomplete");
  const history = Array.isArray(marker.patchHistory) ? marker.patchHistory : [];
  const expectedPatches = [...replayPatches, ...repairPatches];
  const historyMatches = history.length === expectedPatches.length && expectedPatches.every((patch, index) => {
    const observed = history[index];
    const expectedPhase = index < replayPatches.length ? "failure_replay" : "repair";
    return observed?.phase === expectedPhase
      && observed?.id === patch.id
      && observed?.path === patch.path
      && typeof observed.sourceBefore === "string"
      && typeof observed.sourceAfter === "string"
      && (!patch.expectedAfterHash || (observed.sourceAfterCanonical ?? observed.sourceAfter) === patch.expectedAfterHash);
  });
  const finalChecks = Array.isArray(workload.finalChecks) ? workload.finalChecks : [];
  const sourceChecks = [];
  for (const check of finalChecks) {
    const content = await readFile(path.resolve(ROOT, check.path), "utf8");
    const digest = sha256Text(content);
    const includes = Array.isArray(check.includes) ? check.includes.every((value) => content.includes(value)) : true;
    const excludes = Array.isArray(check.excludes) ? check.excludes.every((value) => !content.includes(value)) : true;
    const hashMatches = check.expectedHash === undefined || check.expectedHash === digest;
    sourceChecks.push({ path: check.path, digest, includes, excludes, hashMatches, passed: includes && excludes && hashMatches });
  }
  const expectedGuidance = workload.guidance?.[marker.arm];
  const guidanceMatches = expectedGuidance !== undefined
    && marker.guidance?.mode === expectedGuidance.mode
    && marker.guidance?.sourceRecord === expectedGuidance.sourceRecord;
  const sourceChangeObserved = history.some((entry) => entry.sourceBefore !== entry.sourceAfter);
  const assertion = {
    passed: marker.taskId === task.taskId
      && marker.evidenceKind === "controlled_replay"
      && marker.mutationCount === history.length
      && historyMatches
      && guidanceMatches
      && sourceChangeObserved
      && sourceChecks.length > 0
      && sourceChecks.every((check) => check.passed),
    historyMatches,
    guidanceMatches,
    sourceChangeObserved,
    sourceChecks,
    repairIterations: repairPatches.length,
    expectedRepairIterations: marker.repairIterations,
  };
  const metrics = {
    replay_match: historyMatches ? 1 : 0,
    repair_yield: assertion.passed ? 1 : 0,
    repair_iterations: repairPatches.length,
    downstream_pass: assertion.passed ? 1 : 0,
    prior_passes_preserved: assertion.passed ? 1 : 0,
  };
  return {
    schemaVersion: "my-pi/track-a-evaluator/v2",
    taskId: task.taskId,
    arm: marker.arm,
    accepted: assertion.passed,
    evaluator: "independent node process",
    evidenceKind: "controlled_replay",
    sourceChangeExpected: true,
    sourceChangeObserved,
    groundTruth: marker.groundTruth,
    selected: marker.route,
    guidanceMode: marker.guidance?.mode,
    failureReplay: marker.failureReplay,
    metrics,
    assertion,
  };
}

async function evaluate(task, marker) {
  const workload = task.workload;
  if (task.taskClass === "PN6" && workload?.evaluator?.kind === "measured_source_repair") return evaluateMeasuredSourceRepair(task, marker);
  if (task.taskClass === "PN8" || workload?.evidenceKind === "controlled_replay") return evaluateControlledReplay(task, marker);
  let assertion;
  if (task.taskId === "OT-011") {
    const { ContextRouter } = await importFromRoot("packages/context-router/dist/router.js");
    const result = new ContextRouter().route({
      agentSessionId: "agent-track-a",
      currentWorkItemIds: ["impact-child"],
      dependencyWorkItemIds: [],
      impactResults: [],
      events: [{
        eventType: "ImpactDetected",
        eventId: "impact-track-a-011",
        sequence: 1n,
        occurredAt: "2026-09-13T00:00:00.000Z",
        actor: { kind: "system", id: "evaluator" },
        payload: { affectedWorkItems: ["impact-child"] },
      }],
    });
    const impactObserved = [...result.highPriority, ...result.normalPriority].some((entry) => entry.event.eventType === "ImpactDetected");
    const expectedImpact = marker.arm === "treatment";
    assertion = { passed: impactObserved === expectedImpact, observed: result.normalPriority.map((entry) => entry.reason), expectedImpact };
  } else if (task.taskId === "OT-012") {
    const { ImpactEngine } = await importFromRoot("packages/impact-engine/dist/engine.js");
    const entities = [
      { id: "entity-target", kind: "file", path: "packages/impact-engine/src/engine.ts", stableKey: "file|target", displayName: "engine.ts", fingerprint: { digest: "a".repeat(64) }, observedAt: "2026-09-13T00:00:00.000Z" },
      { id: "entity-dependent", kind: "file", path: "packages/impact-engine/test/impact.test.ts", stableKey: "file|dependent", displayName: "impact.test.ts", fingerprint: { digest: "b".repeat(64) }, observedAt: "2026-09-13T00:00:00.000Z" },
    ];
    const result = new ImpactEngine().compute({
      subject: "intent-track-a-012",
      intent: { id: "intent-track-a-012", workItemId: "work-track-a-012", targets: [{ type: "package", value: "." }] },
      entities,
      edges: [{ from: "entity-dependent", to: "entity-target", kind: "imports", confidence: "strong", provider: "independent-evaluator", observedAt: "2026-09-13T00:00:00.000Z" }],
      workItems: [{ id: "work-track-a-012", title: "Impact package scope", assignee: "agent-track-a" }],
      dependencies: [],
      activeIntents: [],
    });
    const observedEntityCount = result.affectedEntities.length;
    const workItemObserved = result.affectedWorkItems.some((item) => item.workItemId === "work-track-a-012");
    const expectedEntityCount = marker.arm === "treatment" ? 2 : 0;
    assertion = { passed: observedEntityCount === expectedEntityCount && workItemObserved, observed: result.affectedEntities.map((entity) => entity.entityId), expectedEntityCount, workItemObserved };
  } else if (task.taskId === "OT-013") {
    const { renderProfile } = await importFromRoot("packages/host-profiles/dist/render.js");
    const { REQUIRED_PROFILES } = await importFromRoot("packages/host-profiles/dist/profile.js");
    const profile = REQUIRED_PROFILES.find((value) => value.id === "cursor-local");
    const rendered = renderProfile(profile, { command: "node", args: ["--transport", "stdio", "--workspace", "existing"], workspace: "new" });
    const args = rendered.type === "json" ? rendered.json.mcpServers["my-pi"].args : [];
    const workspaceValues = args.filter((value) => value === "--workspace");
    const expectedWorkspaceCount = marker.arm === "treatment" ? 1 : 2;
    const expectedWorkspaceValue = marker.arm === "treatment" ? "existing" : "new";
    assertion = { passed: workspaceValues.length === expectedWorkspaceCount && args[args.lastIndexOf("--workspace") + 1] === expectedWorkspaceValue, observed: args, expectedWorkspaceCount, expectedWorkspaceValue };
  } else {
    throw new Error("no independent evaluator for " + task.taskId);
  }
  const metrics = { ...routeMetrics(marker.route, marker.groundTruth), downstream_pass: assertion.passed ? 1 : 0 };
  const measurementGaps = [];
  if (task.metrics?.some((metric) => metric.id === "repair_iterations")) {
    if (!Number.isInteger(marker.repairIterationsMeasured) || marker.repairIterationsMeasured < 0) measurementGaps.push("repair_iterations requires an independently recorded repair trace");
    else metrics.repair_iterations = marker.repairIterationsMeasured;
  }
  const sourceChangeExpected = marker.arm === "treatment";
  const sourceChangeObserved = marker.sourceAfter !== marker.sourceBefore;
  const accepted = assertion.passed && measurementGaps.length === 0 && marker.taskId === task.taskId && sourceChangeObserved === sourceChangeExpected;
  return { schemaVersion: "my-pi/track-a-evaluator/v2", taskId: task.taskId, arm: marker.arm, accepted, evaluator: "independent node process", sourceChangeExpected, sourceChangeObserved, groundTruth: marker.groundTruth, selected: marker.route, metrics, measurementGaps, assertion };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const task = JSON.parse(await readFile(path.resolve(ROOT, args.task), "utf8"));
  const armFiles = ["control", "treatment"].map((arm) => path.join(ROOT, ".my-pi", "track-a", task.taskId, "arm-" + arm + ".json"));
  let marker;
  for (const file of armFiles) {
    try {
      marker = JSON.parse(await readFile(file, "utf8"));
      break;
    } catch { /* one evaluator invocation runs inside one arm worktree */ }
  }
  if (!marker) throw new Error("no arm marker found under .my-pi/track-a/" + task.taskId);
  const report = await evaluate(task, marker);
  console.log(JSON.stringify(report, null, 2));
  if (!report.accepted) process.exitCode = 1;
  return report.accepted ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
