import { CoordinationClient } from "../../../packages/coordination-client/dist/index.js";

const [runtimeDir, workerId] = process.argv.slice(2);
if (!runtimeDir || !workerId) throw new Error("runtime directory and worker id are required");

try {
  const client = await CoordinationClient.fromRuntimeDir(runtimeDir, { maxAttempts: 2 });
  const health = await client.health();
  const result = await client.call("append_event", {
    projectId: health.projectId,
    eventType: "AgentHeartbeat",
    actor: { kind: "system", name: `worker-${workerId}` },
    payload: { workerId },
  }, `worker-${workerId}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
