import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { ProvenanceReconciler } from "@my-pi/code-state";
import { verifyReceipt } from "@my-pi/change-runtime";
import { CoordinationRuntime } from "@my-pi/coordination-runtime";
import { CURRENT_SCHEMA_VERSION as STORE_SCHEMA_VERSION, SqliteCoordinationStore } from "@my-pi/coordination-store";
import { createEventId, err, type ChangeReceipt } from "@my-pi/contracts";
import { DeterministicProvider, EvaluationRuntime } from "@my-pi/evaluation-runtime";
import type { DaemonConfig } from "./config.js";
import type { DaemonHealth } from "./health.js";
import { CodeStateManager } from "./code-state-manager.js";
import { verifyReceiptState } from "./change-service.js";

export { STORE_SCHEMA_VERSION };

export interface DaemonServices {
  store: SqliteCoordinationStore;
  coordination: CoordinationRuntime;
  evaluation: EvaluationRuntime;
  provenance: ProvenanceReconciler;
  codeStateManager: CodeStateManager;
}

export interface BootstrapOptions {
  testMode: boolean;
}

export function createDaemonServices(config: DaemonConfig, options: BootstrapOptions): DaemonServices {
  const store = new SqliteCoordinationStore(config.databasePath);
  const coordination = new CoordinationRuntime(store, config.projectId);
  const provenance = new ProvenanceReconciler({ verifyReceipt });
  const codeStateManager = new CodeStateManager(store, {
    onReady: async (context) => {
      await coordination.refreshImpactsForWorktree(context.worktreeId);
    },
    onDelta: async (context, delta) => {
      await store.appendEvent({
        projectId: context.projectId,
        eventType: "CodeGraphUpdated",
        actor: { kind: "system", name: "code-state-manager" },
        payload: { projectId: context.projectId, repositoryId: context.repositoryId, worktreeId: context.worktreeId, changedPath: delta.changedPath, entities: delta.entities.length, edges: delta.edges.length, providerHealth: delta.providerHealth },
      });
      await coordination.refreshImpactsForWorktree(context.worktreeId);
    },
    provenance,
    onProvenance: async (result) => {
      await store.appendAudit({
        id: createEventId(),
        projectId: result.projectId,
        occurredAt: result.observedAt,
        operation: "provenance_observed",
        resourceRef: `${String(result.worktreeId)}:${result.path}`,
        ...(result.receiptId === undefined ? {} : { changeRef: String(result.receiptId) }),
        resultCode: `PROVENANCE_${result.status.toUpperCase()}`,
        classification: result.status,
      });
    },
  });
  const evaluation = new EvaluationRuntime(store, config.projectId, [new DeterministicProvider()], {
    resolveStateRef: async (input) => {
      if (!input.changeReceiptId) {
        if (options.testMode) return input.repositoryStateRef;
        throw err.evaluationTargetStale("evaluation must reference a server-verified change receipt");
      }
      const receipt = await store.getProjection<ChangeReceipt>("change_receipt", input.changeReceiptId);
      if (!receipt) throw err.evaluationTargetStale("evaluation change receipt is missing or invalid");
      await verifyReceiptState(receipt, store, config.projectId);
      const derived = `receipt:${receipt.id}:${receipt.receiptDigest}`;
      if (input.repositoryStateRef !== receipt.id && input.repositoryStateRef !== derived) throw err.evaluationTargetStale("evaluation target does not match the server-verified change receipt");
      return derived;
    },
  });
  return { store, coordination, evaluation, provenance, codeStateManager };
}

export async function writeMetadata(config: DaemonConfig, health: DaemonHealth): Promise<void> {
  const temporary = `${config.metadataPath}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(health, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(temporary, config.metadataPath);
        await chmod(config.metadataPath, 0o600).catch(() => undefined);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!(["EPERM", "EBUSY", "ENOTEMPTY"] as string[]).includes(code ?? "") || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
