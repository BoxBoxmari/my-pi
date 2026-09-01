import { promises as fs } from "node:fs";
import { err, type CapabilityClass, type Workspace } from "@ccr/contracts";
import { PolicyEngine } from "@ccr/policy";
import { canonicalizeWithinRoots, type ResolvedPath } from "./path-normalize.js";

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

  async resolveForRead(workspace: Workspace, input: string): Promise<ResolvedPath> {
    const roots = await this.rootsOf(workspace);
    const resolved = await canonicalizeWithinRoots(roots, input, workspace.root);
    if (!resolved.exists) throw err.pathNotFound(`path not found: ${input}`);
    this.authorize(workspace, "read", resolved);
    return resolved;
  }

  async resolveForWrite(workspace: Workspace, input: string): Promise<ResolvedPath> {
    const roots = await this.rootsOf(workspace);
    const resolved = await canonicalizeWithinRoots(roots, input, workspace.root);
    this.authorize(workspace, "write", resolved);
    return resolved;
  }

  private authorize(workspace: Workspace, cls: CapabilityClass, resolved: ResolvedPath): void {
    const verdict = this.policyEngine.authorize(workspace.policy, cls, resolved.relPosix);
    if (verdict.allowed) return;
    if (verdict.reason === "secret-path-denied") {
      throw err.secretPathDenied(`sensitive path denied: ${resolved.relPosix}`);
    }
    throw err.permissionDenied(`operation not permitted (${verdict.reason})`);
  }
}
