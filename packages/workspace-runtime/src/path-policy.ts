import { promises as fs } from "node:fs";
import path from "node:path";
import { err, type CapabilityClass, type Workspace } from "@my-pi/contracts";
import { PolicyEngine } from "@my-pi/policy";
import { canonicalizeWithinRoots, samePath, toPosix, type ResolvedPath } from "./path-normalize.js";

export class PathPolicy {
  constructor(private readonly policyEngine: PolicyEngine = new PolicyEngine()) {}

  private async rootsOf(workspace: Workspace): Promise<string[]> {
    const roots = [workspace.root];
    for (const r of workspace.additionalRoots) {
      try {
        roots.push(await fs.realpath(r));
      } catch {}
    }
    return roots;
  }

  async resolveForRead(workspace: Workspace, input: string, options: { allowMissing?: boolean } = {}): Promise<ResolvedPath> {
    const roots = await this.rootsOf(workspace);
    const resolved = await canonicalizeWithinRoots(roots, input, workspace.root);
    if (!resolved.exists && !options.allowMissing) throw err.pathNotFound(`path not found: ${input}`);
    this.authorize(workspace, "read", resolved);
    return resolved;
  }

  async resolveForWrite(workspace: Workspace, input: string): Promise<ResolvedPath> {
    const roots = await this.rootsOf(workspace);
    const resolved = await canonicalizeWithinRoots(roots, input, workspace.root);
    this.authorize(workspace, "write", resolved);
    return resolved;
  }

  /** Re-check a previously resolved path immediately before a sensitive I/O operation. */
  async revalidate(workspace: Workspace, resolved: ResolvedPath, cls: CapabilityClass): Promise<ResolvedPath> {
    const roots = await this.rootsOf(workspace);
    const current = await canonicalizeWithinRoots(roots, resolved.absolute, workspace.root);
    if (!samePath(current.absolute, resolved.absolute) || current.relPosix !== resolved.relPosix) {
      throw err.pathOutsideWorkspace("path changed after workspace authorization");
    }
    this.authorize(workspace, cls, current);
    return current;
  }

  private authorize(workspace: Workspace, cls: CapabilityClass, resolved: ResolvedPath): void {
    const candidates = [
      resolved.relPosix,
      toPosix(path.relative(workspace.root, resolved.absolute)),
    ];
    const rootName = path.basename(resolved.root);
    if (rootName) candidates.push(`${toPosix(rootName)}/${resolved.relPosix}`);

    for (const candidate of candidates) {
      const verdict = this.policyEngine.authorize(workspace.policy, cls, candidate);
      if (verdict.allowed) continue;
      if (verdict.reason === "secret-path-denied") {
        throw err.secretPathDenied(`sensitive path denied: ${resolved.relPosix}`);
      }
      throw err.permissionDenied(`operation not permitted (${verdict.reason})`);
    }
  }
}
