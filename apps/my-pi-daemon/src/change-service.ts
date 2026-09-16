import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyReceipt } from "@my-pi/change-runtime";
import type { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { err, fingerprintBytes, type ChangeReceipt, type ProjectId, type Worktree } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";

export async function verifyReceiptState(receipt: ChangeReceipt, store: SqliteCoordinationStore, expectedProjectId: ProjectId): Promise<void> {
  if (!verifyReceipt(receipt)) throw err.evaluationResultConflict("change receipt integrity verification failed");
  if (receipt.projectId !== expectedProjectId || !receipt.worktreeId) throw err.evaluationResultConflict("change receipt is not bound to this project and worktree");
  const worktree = await store.getProjection<Worktree>("worktree", receipt.worktreeId);
  if (!worktree) throw err.workItemNotFound("change receipt worktree is not registered");
  const workspace = new WorkspaceRuntime();
  await workspace.open({ root: worktree.root });
  for (const version of receipt.outputVersions ?? []) {
    if (!version.path || path.isAbsolute(version.path) || version.path.split(/[\\/]/).includes("..")) throw err.pathOutsideWorkspace("change receipt contains an unsafe resource path");
    const resolved = await workspace.pathPolicy.resolveForRead(workspace.workspaceOrThrow, version.path);
    const actual = new Uint8Array(await readFile(resolved.absolute));
    if (version.fingerprint === undefined) throw err.evaluationResultConflict("change receipt output is missing its fingerprint");
    const observed = fingerprintBytes(actual);
    if (observed.digest !== version.fingerprint.digest || observed.size !== version.fingerprint.size) throw err.evaluationTargetStale(`change receipt output does not match the registered worktree: ${version.path}`);
  }
}
