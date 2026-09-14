import type { ChangeReceipt, ProjectId, ResourceVersion, WorktreeId } from "@my-pi/contracts";
import { fingerprintsEqual } from "@my-pi/contracts";

export type MutationProvenanceStatus = "managed" | "unmanaged" | "stale_lineage" | "unknown" | "exempt";

export type ProvenanceReasonCode =
  | "verified_receipt_output"
  | "receipt_missing"
  | "receipt_invalid"
  | "receipt_scope_mismatch"
  | "input_lineage_mismatch"
  | "insufficient_fingerprint"
  | "configured_exemption"
  | "unchanged_fingerprint"
  | "receipt_output_mismatch"
  | "invalid_path";

export interface MutationObservation {
  projectId: ProjectId;
  worktreeId: WorktreeId | string;
  path: string;
  previous?: ResourceVersion;
  current?: ResourceVersion;
  changed: boolean;
  observedAt: string;
}

export interface MutationProvenanceResult {
  projectId: ProjectId;
  worktreeId: WorktreeId | string;
  path: string;
  status: MutationProvenanceStatus;
  reasonCodes: ProvenanceReasonCode[];
  observedAt: string;
  receiptId?: ChangeReceipt["id"];
  previous?: ResourceVersion;
  current?: ResourceVersion;
}

export interface ProvenanceReportRequest {
  projectId: ProjectId;
  worktreeId: WorktreeId | string;
  path?: string;
  maxResults?: number;
}

export interface ProvenanceReport {
  schemaVersion: "my-pi/provenance-report/v1";
  projectId: ProjectId;
  worktreeId: WorktreeId | string;
  results: MutationProvenanceResult[];
  truncated: boolean;
  cursor?: { next: string };
  degraded?: { provider: string; reason: string };
}

export interface ClassifyMutationInput {
  observation: MutationObservation;
  receipts: readonly ChangeReceipt[];
  verifyReceipt?: (receipt: ChangeReceipt) => boolean;
  exemptPaths?: readonly string[];
}

export interface ProvenanceReconcilerOptions {
  verifyReceipt?: (receipt: ChangeReceipt) => boolean;
  exemptPaths?: readonly string[];
  maxResults?: number;
}

function normalizePath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return undefined;
  return normalized;
}

function versionPath(version: ResourceVersion | undefined): string | undefined {
  return version === undefined ? undefined : normalizePath(version.path);
}

function usableVersion(version: ResourceVersion | undefined): boolean {
  return version !== undefined && (version.absent === true || version.fingerprint !== undefined);
}

function versionsEqual(left: ResourceVersion | undefined, right: ResourceVersion | undefined): boolean {
  if (!left || !right || versionPath(left) !== versionPath(right)) return false;
  if (left.absent === true || right.absent === true) return left.absent === right.absent;
  if (!left.fingerprint || !right.fingerprint) return false;
  return fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function isExempt(path: string, exemptPaths: readonly string[]): boolean {
  return exemptPaths.some((entry) => {
    const normalized = normalizePath(entry);
    if (!normalized) return false;
    return normalized.endsWith("/**") ? path === normalized.slice(0, -3) || path.startsWith(`${normalized.slice(0, -3)}/`) : path === normalized;
  });
}

function outputVersions(receipt: ChangeReceipt): readonly ResourceVersion[] {
  return receipt.outputVersions ?? receipt.resources ?? [];
}

function sameScope(receipt: ChangeReceipt, observation: MutationObservation): boolean {
  return receipt.projectId === observation.projectId && receipt.worktreeId === observation.worktreeId;
}

function samePath(left: string | undefined, right: string): boolean {
  return left !== undefined && left === right;
}

function resultFor(observation: MutationObservation, path: string, status: MutationProvenanceStatus, reasonCodes: ProvenanceReasonCode[], receipt?: ChangeReceipt): MutationProvenanceResult {
  return {
    projectId: observation.projectId,
    worktreeId: observation.worktreeId,
    path,
    status,
    reasonCodes,
    observedAt: observation.observedAt,
    ...(receipt === undefined ? {} : { receiptId: receipt.id }),
    ...(observation.previous === undefined ? {} : { previous: observation.previous }),
    ...(observation.current === undefined ? {} : { current: observation.current }),
  };
}

/**
 * Classify one changed path without granting admission authority. A managed
 * result requires both a valid receipt digest and a matching input/output
 * lineage; equal bytes by themselves are never sufficient.
 */
export function classifyMutationObservation(input: ClassifyMutationInput): MutationProvenanceResult {
  const { observation } = input;
  const normalizedPath = normalizePath(observation.path);
  if (!normalizedPath) return resultFor(observation, observation.path, "unknown", ["invalid_path"]);
  if (isExempt(normalizedPath, input.exemptPaths ?? [])) return resultFor(observation, normalizedPath, "exempt", ["configured_exemption"]);
  if (!observation.changed) return resultFor(observation, normalizedPath, "unknown", ["unchanged_fingerprint"]);
  if (!usableVersion(observation.current)) return resultFor(observation, normalizedPath, "unknown", ["insufficient_fingerprint"]);

  const samePathReceipts = input.receipts.filter((receipt) => outputVersions(receipt).some((version) => samePath(versionPath(version), normalizedPath)));
  const scopedReceipts = samePathReceipts.filter((receipt) => sameScope(receipt, observation));
  const validReceipts = scopedReceipts.filter((receipt) => receipt.status === "APPLIED" && receipt.verification?.verified === true && input.verifyReceipt?.(receipt) === true);
  const invalidReceipts = scopedReceipts.filter((receipt) => !validReceipts.includes(receipt));
  if (validReceipts.length === 0) {
    if (invalidReceipts.length > 0) return resultFor(observation, normalizedPath, "unknown", ["receipt_invalid"]);
    if (samePathReceipts.length > 0) return resultFor(observation, normalizedPath, "unmanaged", ["receipt_scope_mismatch"]);
    return resultFor(observation, normalizedPath, "unmanaged", ["receipt_missing"]);
  }

  const ordered = [...validReceipts].sort((left, right) => String(right.completedAt ?? right.publishedAt).localeCompare(String(left.completedAt ?? left.publishedAt)));
  const matchingReceipt = ordered.find((receipt) => outputVersions(receipt).some((version) => samePath(versionPath(version), normalizedPath) && versionsEqual(version, observation.current)));
  if (!matchingReceipt) return resultFor(observation, normalizedPath, "unmanaged", ["receipt_output_mismatch"], ordered[0]);

  const inputVersion = (matchingReceipt.inputVersions ?? []).find((version) => samePath(versionPath(version), normalizedPath));
  if (!inputVersion || !usableVersion(inputVersion)) return resultFor(observation, normalizedPath, "unknown", ["insufficient_fingerprint"], matchingReceipt);
  if (observation.previous !== undefined && !versionsEqual(inputVersion, observation.previous)) return resultFor(observation, normalizedPath, "stale_lineage", ["input_lineage_mismatch"], matchingReceipt);
  return resultFor(observation, normalizedPath, "managed", ["verified_receipt_output"], matchingReceipt);
}

/** Stateful watcher seam: unchanged fingerprints are suppressed as observations. */
export class ProvenanceReconciler {
  private readonly previous = new Map<string, ResourceVersion | undefined>();
  private readonly latest = new Map<string, MutationProvenanceResult>();
  private readonly receipts: ChangeReceipt[] = [];

  constructor(private readonly options: ProvenanceReconcilerOptions = {}) {}

  registerReceipt(receipt: ChangeReceipt): void {
    this.receipts.push(receipt);
    this.receipts.sort((left, right) => String(left.completedAt ?? left.publishedAt).localeCompare(String(right.completedAt ?? right.publishedAt)));
  }

  observe(input: Omit<MutationObservation, "previous" | "changed">): MutationProvenanceResult {
    const path = normalizePath(input.path) ?? input.path;
    const key = `${String(input.projectId)}\0${String(input.worktreeId)}\0${path}`;
    const previous = this.previous.get(key);
    const changed = !versionsEqual(previous, input.current);
    const result = classifyMutationObservation({
      observation: { ...input, path, previous, changed },
      receipts: this.receipts,
      verifyReceipt: this.options.verifyReceipt,
      exemptPaths: this.options.exemptPaths,
    });
    this.previous.set(key, input.current);
    this.latest.set(key, result);
    return result;
  }

  report(input: ProvenanceReportRequest): ProvenanceReport {
    const maxResults = input.maxResults ?? this.options.maxResults ?? 256;
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 2_048) throw new RangeError("provenance report maxResults is out of bounds");
    const requestedPath = input.path === undefined ? undefined : normalizePath(input.path);
    if (input.path !== undefined && requestedPath === undefined) throw new Error("provenance report path is invalid");
    const all = [...this.latest.values()]
      .filter((result) => result.projectId === input.projectId && String(result.worktreeId) === String(input.worktreeId) && (requestedPath === undefined || result.path === requestedPath))
      .sort((left, right) => left.path.localeCompare(right.path, "en", { sensitivity: "variant" }) || left.observedAt.localeCompare(right.observedAt));
    const results = all.slice(0, maxResults);
    return {
      schemaVersion: "my-pi/provenance-report/v1",
      projectId: input.projectId,
      worktreeId: input.worktreeId,
      results,
      truncated: results.length < all.length,
      ...(results.length < all.length ? { cursor: { next: String(results.length) } } : {}),
      ...(all.length === 0 ? { degraded: { provider: "code-state", reason: "no provenance observation is available for the requested scope" } } : {}),
    };
  }
}
