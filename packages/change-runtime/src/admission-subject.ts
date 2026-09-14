import { createHash } from "node:crypto";

export const ADMISSION_SUBJECT_SCHEMA_VERSION = "my-pi/admission-subject/v1" as const;

export type CanonicalChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export interface AdmissionChangeInput {
  status: CanonicalChangeStatus;
  path: string;
  previousPath?: string;
  mode: string;
  blobOid?: string;
  absent?: boolean;
}

export interface CanonicalAdmissionChange {
  status: CanonicalChangeStatus;
  path: string;
  previousPath?: string;
  mode: string;
  result: { blobOid: string } | { absent: true };
}

export interface AdmissionSubjectInput {
  repositoryIdentity: string;
  baseCommit: string;
  headCommit?: string;
  changes: readonly AdmissionChangeInput[];
}

export interface CanonicalAdmissionSubject {
  schemaVersion: typeof ADMISSION_SUBJECT_SCHEMA_VERSION;
  repositoryIdentity: string;
  baseCommit: string;
  headCommit?: string;
  changes: CanonicalAdmissionChange[];
  subjectDigest: string;
  canonical: string;
}

const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/i;
const OID_PATTERN = /^[0-9a-f]{40,64}$/i;
const MODE_PATTERN = /^[0-7]{6}$/;

/** JSON with deterministic object-key ordering. Arrays are already sorted by their caller. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function normalizeGitPath(value: string, label = "path"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) throw new Error(`${label} must be a non-empty path`);
  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) throw new Error(`${label} must be relative`);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) throw new Error(`${label} contains an invalid segment`);
  return normalized;
}

export function isAdmissionProvenancePath(value: string): boolean {
  return value === ".my-pi/provenance" || value.startsWith(".my-pi/provenance/");
}

function normalizeCommit(value: string, label: string): string {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${label} must be a full Git object id`);
  return value.toLowerCase();
}

function normalizeChange(input: AdmissionChangeInput, index: number): CanonicalAdmissionChange | undefined {
  const path = normalizeGitPath(input.path, `changes[${index}].path`);
  const previousPath = input.previousPath === undefined ? undefined : normalizeGitPath(input.previousPath, `changes[${index}].previousPath`);
  if (isAdmissionProvenancePath(path) || (previousPath !== undefined && isAdmissionProvenancePath(previousPath))) return undefined;
  if (!MODE_PATTERN.test(input.mode)) throw new Error(`changes[${index}].mode must be a six-digit octal Git mode`);
  if (input.status === "renamed" && previousPath === undefined) throw new Error(`changes[${index}].previousPath is required for a rename`);
  if (input.status !== "renamed" && previousPath !== undefined) throw new Error(`changes[${index}].previousPath is only valid for a rename`);
  if (input.absent === true) {
    if (input.blobOid !== undefined) throw new Error(`changes[${index}] cannot contain both absent and blobOid`);
    return { status: input.status, path, ...(previousPath === undefined ? {} : { previousPath }), mode: input.mode, result: { absent: true } };
  }
  if (input.blobOid === undefined || !OID_PATTERN.test(input.blobOid)) throw new Error(`changes[${index}].blobOid must be a full Git object id or absent must be true`);
  return { status: input.status, path, ...(previousPath === undefined ? {} : { previousPath }), mode: input.mode, result: { blobOid: input.blobOid.toLowerCase() } };
}

export function canonicalizeAdmissionSubject(input: AdmissionSubjectInput): CanonicalAdmissionSubject {
  if (typeof input.repositoryIdentity !== "string" || input.repositoryIdentity.length === 0 || input.repositoryIdentity.length > 2_048) throw new Error("repositoryIdentity is invalid");
  const baseCommit = normalizeCommit(input.baseCommit, "baseCommit");
  const headCommit = input.headCommit === undefined ? undefined : normalizeCommit(input.headCommit, "headCommit");
  const changes = input.changes.map(normalizeChange).filter((change): change is CanonicalAdmissionChange => change !== undefined).sort((left, right) => {
    const leftKey = `${left.path}\0${left.previousPath ?? ""}\0${left.status}\0${left.mode}\0${stableJson(left.result)}`;
    const rightKey = `${right.path}\0${right.previousPath ?? ""}\0${right.status}\0${right.mode}\0${stableJson(right.result)}`;
    return leftKey.localeCompare(rightKey, "en", { sensitivity: "variant" });
  });
  const seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.path)) throw new Error(`duplicate canonical change path: ${change.path}`);
    seen.add(change.path);
  }
  const payload = {
    schemaVersion: ADMISSION_SUBJECT_SCHEMA_VERSION,
    repositoryIdentity: input.repositoryIdentity,
    baseCommit,
    ...(headCommit === undefined ? {} : { headCommit }),
    changes,
  };
  const canonical = stableJson(payload);
  const subjectDigest = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  return { ...payload, changes, subjectDigest, canonical };
}
