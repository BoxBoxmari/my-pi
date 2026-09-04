import { promises as fs } from "node:fs";
import path from "node:path";
import { fingerprintBytes, isLikelyBinary, type CodeEntity } from "@my-pi/contracts";
import type { CodeGraphDelta, IndexContext } from "./model.js";
import { fileStableKey, relativePosix, stableEntityId } from "./identity.js";
import type { CodeStateProvider } from "./provider.js";

const MAX_INDEX_FILE_BYTES = 8 * 1024 * 1024;

export class FileSystemCodeStateProvider implements CodeStateProvider {
  readonly name = "fs";

  supports(_filePath: string): boolean {
    return true;
  }

  async indexFile(context: IndexContext, filePath: string): Promise<CodeGraphDelta> {
    context.signal.throwIfAborted();
    const absolute = path.resolve(context.root, filePath);
    const relativePath = relativePosix(context.root, absolute);
    if (relativePath.startsWith("../") || relativePath === "..") throw new Error("code-state path is outside the worktree");
    const stableKey = fileStableKey(context.repositoryIdentity, relativePath);
    const observedAt = new Date().toISOString();
    try {
      const details = await fs.stat(absolute);
      if (!details.isFile() || details.size > MAX_INDEX_FILE_BYTES) {
        return { provider: this.name, changedPath: relativePath, entities: [], edges: [], removedStableKeys: [stableKey], observedAt, providerHealth: { fs: { status: "degraded", message: "file is not indexable or exceeds the file-size bound" } } };
      }
      const bytes = new Uint8Array(await fs.readFile(absolute));
      const entity: CodeEntity = {
        id: stableEntityId(stableKey),
        projectId: context.projectId,
        repositoryId: context.repositoryId,
        worktreeId: context.worktreeId,
        kind: "file",
        stableKey,
        displayName: path.basename(relativePath),
        path: relativePath,
        fingerprint: fingerprintBytes(bytes),
        observedAt,
        provider: "fs",
      };
      return {
        provider: this.name,
        changedPath: relativePath,
        entities: [entity],
        edges: [],
        removedStableKeys: [],
        observedAt,
        providerHealth: { fs: { status: isLikelyBinary(bytes) ? "ready" : "ready" } },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { provider: this.name, changedPath: relativePath, entities: [], edges: [], removedStableKeys: [stableKey], observedAt, providerHealth: { fs: { status: "ready" } } };
      throw error;
    }
  }

  async invalidate(context: IndexContext, paths: string[]): Promise<CodeGraphDelta[]> {
    return paths.map((filePath) => {
      const relativePath = relativePosix(context.root, path.resolve(context.root, filePath));
      const stableKey = fileStableKey(context.repositoryIdentity, relativePath);
      return { provider: this.name, changedPath: relativePath, entities: [], edges: [], removedStableKeys: [stableKey], observedAt: new Date().toISOString(), providerHealth: { fs: { status: "ready" } } };
    });
  }
}
