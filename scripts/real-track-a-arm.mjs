#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = process.cwd();

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task" || arg === "--arm") {
      const value = argv[index + 1];
      if (!value) throw new Error(arg + " requires a value");
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/real-track-a-arm.mjs --task <task.json> --arm control|treatment");
      return undefined;
    } else throw new Error("unknown argument: " + arg);
  }
  if (!values.task || !values.arm) throw new Error("--task and --arm are required");
  if (!["control", "treatment"].includes(values.arm)) throw new Error("--arm must be control or treatment");
  return values;
}

function unwrap(result) {
  if (result.isError) throw new Error(result.content?.map((item) => item.text ?? "").join("\\n") || "my-pi tool failed");
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("my-pi tool returned no text content");
  const envelope = JSON.parse(text);
  if (envelope.error) throw new Error(envelope.error.message ?? "my-pi request failed");
  return envelope.data ?? envelope;
}

async function connectMyPi() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js"), "--workspace", ROOT, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "my-pi-real-track-a-arm", version: "1" });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  return unwrap(await client.callTool({ name, arguments: args }));
}

async function writeJson(client, relativePath, value) {
  return call(client, "fs_write", { path: relativePath, content: JSON.stringify(value, null, 2) + "\n" });
}


async function readSnapshot(client, relativePath) {
  return call(client, "fs_read", { path: relativePath, start_line: 1, end_line: 200_000 });
}

async function applyPatches(client, patches, phase, history) {
  for (const patch of patches) {
    if (!patch || typeof patch.path !== "string" || typeof patch.old !== "string" || typeof patch.new !== "string") throw new Error(phase + " patch is incomplete");
    const snapshot = await readSnapshot(client, patch.path);
    const patched = await call(client, "fs_patch", {
      path: patch.path,
      expected_hash: snapshot.content_hash,
      patch: { hunks: [{ old: patch.old, new: patch.new }] },
    });
    history.push({
      phase,
      id: patch.id,
      path: patch.path,
      sourceBefore: snapshot.content_hash,
      sourceAfter: patched.content_hash,
    });
  }
}

async function sourceHashes(client, paths) {
  const hashes = {};
  for (const relativePath of [...new Set(paths)]) hashes[relativePath] = (await readSnapshot(client, relativePath)).content_hash;
  return hashes;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const taskPath = path.resolve(ROOT, args.task);
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  const workload = task.workload;
  if (!workload || !Array.isArray(workload.groundTruth)) throw new Error("task workload is incomplete");
  const client = await connectMyPi();
  try {
    const markerPath = ".my-pi/track-a/" + task.taskId + "/arm-" + args.arm + ".json";
    await mkdir(path.resolve(ROOT, path.dirname(markerPath)), { recursive: true });
    const isControlledReplay = task.taskClass === "PN8" || workload.evidenceKind === "controlled_replay";
    if (isControlledReplay) {
      const replayPatches = workload.failureReplay?.patches;
      const repairPatches = workload.repairPatches?.[args.arm] ?? workload.repairPatches?.shared;
      if (!Array.isArray(replayPatches) || replayPatches.length === 0) throw new Error("PN8 workload failureReplay.patches is empty");
      if (!Array.isArray(repairPatches) || repairPatches.length === 0) throw new Error("PN8 workload repairPatches is empty");
      const patchHistory = [];
      const sourceBefore = await sourceHashes(client, [...replayPatches, ...repairPatches].map((patch) => patch.path));
      await applyPatches(client, replayPatches, "failure_replay", patchHistory);
      await applyPatches(client, repairPatches, "repair", patchHistory);
      const sourceAfter = await sourceHashes(client, [...replayPatches, ...repairPatches].map((patch) => patch.path));
      const route = Array.isArray(workload[args.arm + "Route"]) ? workload[args.arm + "Route"] : [];
      const guidance = workload.guidance?.[args.arm] ?? null;
      const markerValue = {
        schemaVersion: "my-pi/track-a-arm/v2",
        taskClass: "PN8",
        evidenceKind: "controlled_replay",
        taskId: task.taskId,
        arm: args.arm,
        route,
        groundTruth: workload.groundTruth,
        sourceBefore,
        sourceAfter,
        patchHistory,
        failureReplay: {
          id: workload.failureReplay.id,
          sourceRecord: workload.failureReplay.sourceRecord,
        },
        guidance,
        repairIterations: repairPatches.length,
        mutationCount: patchHistory.length,
        mutationAuthority: "official my-pi fs_patch with CAS expected_hash for failure replay and repair",
      };
      await writeJson(client, markerPath, markerValue);
      console.log(JSON.stringify({ ok: true, taskId: task.taskId, arm: args.arm, evidenceKind: "controlled_replay", sourceAfter, repairIterations: repairPatches.length }, null, 2));
      return 0;
    }

    if (typeof workload.targetPath !== "string" || !workload.patch) throw new Error("PN6 workload source patch is incomplete");
    const snapshot = await readSnapshot(client, workload.targetPath);
    const patched = args.arm === "treatment"
      ? await call(client, "fs_patch", {
        path: workload.targetPath,
        expected_hash: snapshot.content_hash,
        patch: { hunks: [{ old: workload.patch.old, new: workload.patch.new }] },
      })
      : snapshot;
    const route = args.arm === "treatment" ? workload.treatmentRoute : workload.controlRoute;
    if (!Array.isArray(route) || route.length === 0) throw new Error("workload route is empty");
    await writeJson(client, markerPath, {
      schemaVersion: "my-pi/track-a-arm/v1",
      taskId: task.taskId,
      arm: args.arm,
      targetPath: workload.targetPath,
      route,
      groundTruth: workload.groundTruth,
      sourceBefore: snapshot.content_hash,
      sourceAfter: patched.content_hash,
      mutationAuthority: args.arm === "treatment" ? "official my-pi fs_patch with CAS expected_hash" : "official my-pi fs_read control baseline (no mutation)",
    });
    console.log(JSON.stringify({ ok: true, taskId: task.taskId, arm: args.arm, targetPath: workload.targetPath, sourceAfter: patched.content_hash, route }, null, 2));
    return 0;
  } finally {
    await client.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
