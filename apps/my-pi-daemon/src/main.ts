import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMyPiError } from "@my-pi/contracts";
import { resolveDaemonConfig } from "./config.js";
import { DaemonLifecycle } from "./lifecycle.js";
import type { DaemonHealth } from "./health.js";
import { IpcServer } from "./ipc-server.js";
import { acquireProjectLock, ProjectAlreadyRunningError } from "./project-lock.js";
import { STORE_SCHEMA_VERSION, createDaemonServices, writeMetadata } from "./bootstrap.js";
import { createRequestRouter } from "./request-router.js";
import { createCodeStateScheduler } from "./session-service.js";
import { unlink } from "node:fs/promises";

interface CliOptions {
  workspaceRoot?: string;
  runtimeDir?: string;
  databasePath?: string;
  allowNonGit: boolean;
  testMode: boolean;
  protocolVersion?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { allowNonGit: false, testMode: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--workspace") options.workspaceRoot = argv[++index];
    else if (arg === "--runtime-dir") options.runtimeDir = argv[++index];
    else if (arg === "--database") options.databasePath = argv[++index];
    else if (arg === "--allow-non-git") options.allowNonGit = true;
    else if (arg === "--test-mode") options.testMode = true;
    else if (arg === "--protocol-version") options.protocolVersion = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("my-pi-daemon --workspace <git-root> [--runtime-dir <dir>] [--database <path>] [--allow-non-git] [--test-mode]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.workspaceRoot) throw new Error("--workspace is required");
  return options;
}

export async function runDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const config = await resolveDaemonConfig({
    workspaceRoot: options.workspaceRoot!,
    runtimeDir: options.runtimeDir,
    databasePath: options.databasePath,
    allowNonGit: options.allowNonGit,
    protocolVersion: options.protocolVersion,
  });
  const lock = await acquireProjectLock(config.lockPath);
  const lifecycle = new DaemonLifecycle();
  const startedAt = new Date().toISOString();
  const services = createDaemonServices(config, { testMode: options.testMode });
  const { store, provenance, codeStateManager } = services;
  const scheduler = createCodeStateScheduler(store, codeStateManager);
  let ipc: IpcServer | undefined;
  let stopping = false;
  const health = (): DaemonHealth => ({
    schemaVersion: "1",
    protocolVersion: config.protocolVersion,
    storeSchemaVersion: STORE_SCHEMA_VERSION,
    state: lifecycle.state,
    projectId: config.projectId,
    projectKey: config.project.projectKey,
    projectRoot: config.project.root,
    projectCanonicalIdentity: config.project.canonicalIdentity,
    endpoint: config.endpoint,
    pid: process.pid,
    startedAt,
    rssBytes: process.memoryUsage().rss,
    store: lifecycle.state === "stopping" ? "closed" : "ready",
    codeState: codeStateManager.health(),
  });
  const router = createRequestRouter({
    runtime: services.coordination,
    evaluation: services.evaluation,
    store,
    health,
    expectedProjectId: config.projectId,
    testMode: options.testMode,
    daemonProject: config.project,
    scheduleCodeStateRegistration: scheduler.schedule,
    registerProvenanceReceipt: (receipt) => provenance.registerReceipt(receipt),
    provenanceReport: (input) => provenance.report(input),
  });
  try {
    await store.init();
    ipc = new IpcServer(config.endpoint, router.handle, config.maxFrameBytes, config.protocolVersion);
    await ipc.listen();
    lifecycle.set("ready");
    await writeMetadata(config, health());
    console.error(`[my-pi-daemon] ready project=${config.project.projectKey} transport=${config.endpoint.transport} pid=${process.pid}`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        if (stopping) return;
        stopping = true;
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } finally {
    lifecycle.set("stopping");
    await ipc?.close();
    await scheduler.drain();
    await codeStateManager.stop();
    await store.close();
    await unlink(config.metadataPath).catch(() => undefined);
    await lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDaemon().catch((error) => {
    if (error instanceof ProjectAlreadyRunningError) {
      console.error(`[my-pi-daemon] ${error.message}`);
    } else if (isMyPiError(error)) {
      console.error(`[my-pi-daemon] ${error.code}: ${error.message}`);
    } else {
      console.error(`[my-pi-daemon] ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  });
}
