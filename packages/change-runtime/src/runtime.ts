import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fingerprintBytes, type ChangeReceipt, type FileFingerprint, type ResourcePublicationResult, type ResourceVersion } from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { assertPrecondition } from "./admission.js";
import { canonicalizeTarget } from "./canonical.js";
import { makeChangeProposal, makeCompositeChangeProposal, type ChangeProposalInput } from "./proposal.js";
import { publishOne } from "./publication.js";
import { makeReceipt } from "./receipt.js";
import type { ResourcePrecondition } from "./resource-version.js";

export interface ApplyBytesInput extends Omit<ChangeProposalInput, "precondition"> {
  bytes: Uint8Array;
  precondition: ResourcePrecondition;
  signal?: AbortSignal;
}

export interface TransformInput extends Omit<ChangeProposalInput, "precondition"> {
  precondition: ResourcePrecondition;
  transform: (current: Uint8Array, fingerprint: FileFingerprint) => Promise<Uint8Array> | Uint8Array;
  signal?: AbortSignal;
}

export interface ApplyManyInput {
  changes: ApplyBytesInput[];
}

export class ChangeRuntime {
  constructor(private readonly runtime: WorkspaceRuntime) {}

  async applyBytes(input: ApplyBytesInput): Promise<ChangeReceipt> {
    const target = await canonicalizeTarget(this.runtime, input.path);
    const startedAt = new Date().toISOString();
    const precondition = { ...input.precondition, path: target.resolved.relPosix } as ResourcePrecondition;
    const proposal = makeChangeProposal({
      ...input,
      path: target.resolved.relPosix,
      precondition,
      operation: precondition.condition === "absent" ? "create" : "replace",
      payloadDigest: bytesDigest(input.bytes),
      policyContext: { workspaceMode: this.runtime.workspaceOrThrow.policy.mode },
    });
    let current: Uint8Array | undefined;
    try {
      current = new Uint8Array(await fs.readFile(target.resolved.absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertPrecondition(precondition, current);
    const published = await publishOne(this.runtime, target.resolved.relPosix, target.resolved.absolute, input.bytes, precondition, input.signal);
    const output = { path: target.resolved.relPosix, fingerprint: { algorithm: "sha256" as const, digest: published.digest, size: published.size }, absent: false };
    return makeReceipt(proposal, "APPLIED", [current ? { path: target.resolved.relPosix, fingerprint: fingerprintBytes(current), absent: false } : { path: target.resolved.relPosix, absent: true }], [output], startedAt, new Date().toISOString(), [{ path: target.resolved.relPosix, status: "APPLIED" }]);
  }

  async applyTransform(input: TransformInput): Promise<ChangeReceipt> {
    const target = await canonicalizeTarget(this.runtime, input.path);
    let current: Uint8Array | undefined;
    try {
      current = new Uint8Array(await fs.readFile(target.resolved.absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertPrecondition(input.precondition, current);
    if (!current) throw new Error("transform requires an existing resource");
    input.signal?.throwIfAborted();
    const transformed = await input.transform(current, fingerprintBytes(current));
    return this.applyBytes({ ...input, bytes: transformed });
  }

  async applyMany(input: ApplyManyInput): Promise<ChangeReceipt> {
    if (input.changes.length === 0 || input.changes.length > 100) throw new Error("applyMany requires between 1 and 100 changes");
    const prepared = await this.preflight(input.changes);
    prepared.sort((a, b) => a.path.localeCompare(b.path));
    assertBatchMetadata(prepared.map((item) => item.change));
    const proposal = makeCompositeChangeProposal({
      projectId: prepared[0]?.change.projectId,
      worktreeId: prepared[0]?.change.worktreeId,
      agentSessionId: prepared[0]?.change.agentSessionId,
      workItemId: prepared[0]?.change.workItemId,
      intentId: prepared[0]?.change.intentId,
      resources: prepared.map(({ change, path: targetPath, precondition }) => ({ path: targetPath, precondition, operation: precondition.condition === "absent" ? "create" : "replace", payloadDigest: bytesDigest(change.bytes) })),
      policyContext: { workspaceMode: this.runtime.workspaceOrThrow.policy.mode },
    });
    const startedAt = new Date().toISOString();
    const inputVersions: ResourceVersion[] = prepared.map(({ path: targetPath, current }) => current ? { path: targetPath, fingerprint: fingerprintBytes(current), absent: false } : { path: targetPath, absent: true });
    const outputVersions: ResourceVersion[] = [];
    const resourceResults: ResourcePublicationResult[] = [];
    for (const { change, path: targetPath, absolute, precondition } of prepared) {
      try {
        const published = await publishOne(this.runtime, targetPath, absolute, change.bytes, precondition, change.signal);
        outputVersions.push({ path: targetPath, fingerprint: { algorithm: "sha256", digest: published.digest, size: published.size }, absent: false });
        resourceResults.push({ path: targetPath, status: "APPLIED" });
      } catch (error) {
        if (outputVersions.length === 0) throw error;
        resourceResults.push({ path: targetPath, status: "REJECTED", error: error instanceof Error ? error.message : String(error) });
        return makeReceipt(proposal, "PARTIAL", inputVersions, outputVersions, startedAt, new Date().toISOString(), resourceResults);
      }
    }
    return makeReceipt(proposal, "APPLIED", inputVersions, outputVersions, startedAt, new Date().toISOString(), resourceResults);
  }

  private async preflight(changes: ApplyBytesInput[]): Promise<Array<{ change: ApplyBytesInput; path: string; absolute: string; precondition: ResourcePrecondition; current?: Uint8Array }>> {
    const seenPaths = new Set<string>();
    const prepared: Array<{ change: ApplyBytesInput; path: string; absolute: string; precondition: ResourcePrecondition; current?: Uint8Array }> = [];
    for (const change of changes) {
      const target = await canonicalizeTarget(this.runtime, change.path);
      const pathKey = process.platform === "win32" ? target.resolved.relPosix.toLowerCase() : target.resolved.relPosix;
      if (seenPaths.has(pathKey)) throw new Error(`applyMany contains duplicate target path: ${target.resolved.relPosix}`);
      seenPaths.add(pathKey);
      let current: Uint8Array | undefined;
      try {
        current = new Uint8Array(await fs.readFile(target.resolved.absolute));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const precondition = { ...change.precondition, path: target.resolved.relPosix } as ResourcePrecondition;
      assertPrecondition(precondition, current);
      prepared.push({ change, path: target.resolved.relPosix, absolute: target.resolved.absolute, precondition, current });
    }
    return prepared;
  }
}

function bytesDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertBatchMetadata(changes: ApplyBytesInput[]): void {
  const first = changes[0];
  if (!first) return;
  for (const current of changes.slice(1)) {
    for (const field of ["projectId", "worktreeId", "agentSessionId", "workItemId", "intentId"] as const) {
      if (current[field] !== first[field]) throw new Error(`applyMany requires a single ${field} across the composite proposal`);
    }
  }
}
