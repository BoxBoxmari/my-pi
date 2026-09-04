import { promises as fs } from "node:fs";
import { atomicCreateNoReplace, atomicReplaceBytes, type WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { assertPrecondition } from "./admission.js";
import type { ResourcePrecondition } from "./resource-version.js";

export async function publishOne(runtime: WorkspaceRuntime, path: string, target: string, bytes: Uint8Array, precondition: ResourcePrecondition, signal?: AbortSignal): Promise<{ digest: string; size: number }> {
  let result: { digest: string; size: number } | undefined;
  await runtime.mutatePath(path, async () => {
    const workspace = runtime.workspaceOrThrow;
    const resolved = await runtime.pathPolicy.revalidate(workspace, { absolute: target, relPosix: path, root: workspace.root, exists: true }, "write");
    let current: Uint8Array | undefined;
    try {
      current = new Uint8Array(await fs.readFile(resolved.absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertPrecondition(precondition, current);
    const published = precondition.condition === "absent"
      ? await atomicCreateNoReplace(resolved.absolute, bytes, { signal })
      : await atomicReplaceBytes(resolved.absolute, bytes, { signal });
    result = { digest: published.digest, size: published.size };
  });
  return result!;
}
