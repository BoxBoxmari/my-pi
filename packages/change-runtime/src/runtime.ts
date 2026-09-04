import { promises as fs } from "node:fs";
import { fingerprintBytes, type ChangeReceipt, type FileFingerprint } from "@my-pi/contracts";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { assertPrecondition } from "./admission.js";
import { canonicalizeTarget } from "./canonical.js";
import { makeChangeProposal, type ChangeProposalInput } from "./proposal.js";
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
    const proposal = makeChangeProposal({ ...input, path: target.resolved.relPosix });
    let current: Uint8Array | undefined;
    try {
      current = new Uint8Array(await fs.readFile(target.resolved.absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertPrecondition(input.precondition, current);
    const published = await publishOne(this.runtime, target.resolved.relPosix, target.resolved.absolute, input.bytes, input.precondition, input.signal);
    const output = { path: target.resolved.relPosix, fingerprint: { algorithm: "sha256" as const, digest: published.digest, size: published.size }, absent: false };
    return makeReceipt(proposal, "APPLIED", [current ? { path: target.resolved.relPosix, fingerprint: fingerprintBytes(current), absent: false } : { path: target.resolved.relPosix, absent: true }], [output], startedAt, new Date().toISOString());
  }

  async applyTransform(input: TransformInput): Promise<ChangeReceipt> {
    const target = await canonicalizeTarget(this.runtime, input.path);
    const startedAt = new Date().toISOString();
    const proposal = makeChangeProposal({ ...input, path: target.resolved.relPosix });
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
    const ordered = [...input.changes].sort((a, b) => a.path.localeCompare(b.path));
    await this.preflight(ordered);
    const receipts: ChangeReceipt[] = [];
    for (const change of ordered) {
      try {
        receipts.push(await this.applyBytes(change));
      } catch (error) {
        if (receipts.length === 0) throw error;
        const first = receipts[0]!;
        const proposal = makeChangeProposal(ordered[0]!);
        return makeReceipt(proposal, "PARTIAL", receipts.flatMap((receipt) => receipt.inputVersions ?? []), receipts.flatMap((receipt) => receipt.outputVersions ?? []), first.startedAt ?? new Date().toISOString(), new Date().toISOString());
      }
    }
    const first = receipts[0]!;
    const proposal = makeChangeProposal(ordered[0]!);
    return makeReceipt(proposal, "APPLIED", receipts.flatMap((receipt) => receipt.inputVersions ?? []), receipts.flatMap((receipt) => receipt.outputVersions ?? []), first.startedAt ?? new Date().toISOString(), new Date().toISOString());
  }

  private async preflight(changes: ApplyBytesInput[]): Promise<void> {
    const seenPaths = new Set<string>();
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
      assertPrecondition(change.precondition, current);
    }
  }
}
