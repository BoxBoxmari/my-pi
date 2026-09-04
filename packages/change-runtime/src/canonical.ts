import type { Workspace, WorkspaceId } from "@my-pi/contracts";
import type { WorkspaceRuntime, ResolvedPath } from "@my-pi/workspace-runtime";

export interface CanonicalTarget {
  workspaceId: WorkspaceId;
  workspace: Workspace;
  resolved: ResolvedPath;
}

export async function canonicalizeTarget(runtime: WorkspaceRuntime, inputPath: string): Promise<CanonicalTarget> {
  const workspace = runtime.workspaceOrThrow;
  const resolved = await runtime.pathPolicy.resolveForWrite(workspace, inputPath);
  const revalidated = await runtime.pathPolicy.revalidate(workspace, resolved, "write");
  return { workspaceId: workspace.id, workspace, resolved: revalidated };
}
