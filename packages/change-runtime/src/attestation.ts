import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAdmissionProvenancePath, normalizeGitPath, stableJson } from "./admission-subject.js";

export const ADMISSION_ATTESTATION_SCHEMA_VERSION = "my-pi/admission-attestation/v1" as const;
export const ADMISSION_SIGNATURE_ALGORITHM = "ed25519" as const;

export interface AttestationReceiptCoverage {
  path: string;
  receiptDigest: string;
}

export interface AdmissionAttestation {
  schemaVersion: typeof ADMISSION_ATTESTATION_SCHEMA_VERSION;
  algorithm: typeof ADMISSION_SIGNATURE_ALGORITHM;
  subjectDigest: string;
  repositoryIdentity: string;
  baseCommit: string;
  headCommit?: string;
  coveredReceipts: AttestationReceiptCoverage[];
  authorityKeyId: string;
  issuedAt: string;
  expiresAt?: string;
  signature: string;
}

export interface RegisteredAdmissionAuthority {
  keyId: string;
  publicKeyPem: string;
}

export interface AuthorityIdentity extends RegisteredAdmissionAuthority {
  privateKeyPath: string;
  privateKeyPem: string;
}

export interface AuthorityIdentityOptions {
  keyId: string;
  privateKeyPath?: string;
  workspaceRoots?: readonly string[];
}

export interface CreateAttestationInput {
  subjectDigest: string;
  repositoryIdentity: string;
  baseCommit: string;
  headCommit?: string;
  coveredReceipts: readonly AttestationReceiptCoverage[];
  authorityKeyId: string;
  privateKey: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface AttestationVerificationInput {
  attestation: unknown;
  authority: RegisteredAdmissionAuthority;
  expectedSubjectDigest: string;
  expectedCoverage: readonly AttestationReceiptCoverage[];
  expectedBaseCommit?: string;
  expectedHeadCommit?: string;
  now?: string;
  maxAgeMs?: number;
}

export interface AttestationVerification {
  valid: boolean;
  reasonCodes: string[];
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function safeKeyId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("authority key id is invalid");
  return value;
}

function normalizedCoverage(input: readonly AttestationReceiptCoverage[]): AttestationReceiptCoverage[] {
  const values = input.map((entry, index) => {
    const normalizedPath = normalizeGitPath(entry.path, `coveredReceipts[${index}].path`);
    if (isAdmissionProvenancePath(normalizedPath)) throw new Error("provenance artifacts cannot be receipt coverage");
    if (typeof entry.receiptDigest !== "string" || entry.receiptDigest.length < 8 || entry.receiptDigest.length > 256) throw new Error(`coveredReceipts[${index}].receiptDigest is invalid`);
    return { path: normalizedPath, receiptDigest: entry.receiptDigest };
  }).sort((left, right) => left.path.localeCompare(right.path, "en", { sensitivity: "variant" }) || left.receiptDigest.localeCompare(right.receiptDigest, "en", { sensitivity: "variant" }));
  const seen = new Set<string>();
  for (const entry of values) {
    if (seen.has(entry.path)) throw new Error(`duplicate receipt coverage path: ${entry.path}`);
    seen.add(entry.path);
  }
  return values;
}

function attestationPayload(attestation: Omit<AdmissionAttestation, "signature">): string {
  return stableJson(attestation);
}

function defaultAuthorityPath(keyId: string): string {
  const configRoot = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
    : process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configRoot, "my-pi", "authority", `${safeKeyId(keyId)}.ed25519.pem`);
}

function isWithin(root: string, candidate: string): boolean {
  const rootValue = path.resolve(root);
  const candidateValue = path.resolve(candidate);
  const relative = path.relative(rootValue, candidateValue);
  const contained = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return process.platform === "win32" ? contained || rootValue.toLowerCase() === candidateValue.toLowerCase() : contained;
}

export function assertPrivateKeyOutsideWorkspace(privateKeyPath: string, workspaceRoots: readonly string[]): void {
  if (workspaceRoots.some((root) => isWithin(root, privateKeyPath))) throw new Error("private authority key must be outside authorized workspace roots");
}

export async function loadOrCreateAuthorityIdentity(options: AuthorityIdentityOptions): Promise<AuthorityIdentity> {
  const keyId = safeKeyId(options.keyId);
  const privateKeyPath = path.resolve(options.privateKeyPath ?? defaultAuthorityPath(keyId));
  assertPrivateKeyOutsideWorkspace(privateKeyPath, options.workspaceRoots ?? []);
  await mkdir(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  let privateKeyPem: string;
  try {
    privateKeyPem = await readFile(privateKeyPath, "utf8");
    createPrivateKey(privateKeyPem);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const generated = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privateKeyPem = generated.privateKey;
    await writeFile(privateKeyPath, privateKeyPem, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(async (writeError: unknown) => {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      privateKeyPem = await readFile(privateKeyPath, "utf8");
      createPrivateKey(privateKeyPem);
    });
  }
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
  return { keyId, privateKeyPath, privateKeyPem, publicKeyPem };
}

export function createAdmissionAttestation(input: CreateAttestationInput): AdmissionAttestation {
  const authorityKeyId = safeKeyId(input.authorityKeyId);
  const coveredReceipts = normalizedCoverage(input.coveredReceipts);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(issuedAt))) throw new Error("issuedAt is invalid");
  if (input.expiresAt !== undefined && Number.isNaN(Date.parse(input.expiresAt))) throw new Error("expiresAt is invalid");
  const unsigned: Omit<AdmissionAttestation, "signature"> = {
    schemaVersion: ADMISSION_ATTESTATION_SCHEMA_VERSION,
    algorithm: ADMISSION_SIGNATURE_ALGORITHM,
    subjectDigest: input.subjectDigest,
    repositoryIdentity: input.repositoryIdentity,
    baseCommit: input.baseCommit.toLowerCase(),
    ...(input.headCommit === undefined ? {} : { headCommit: input.headCommit.toLowerCase() }),
    coveredReceipts,
    authorityKeyId,
    issuedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
  const signature = sign(null, Buffer.from(attestationPayload(unsigned), "utf8"), createPrivateKey(input.privateKey)).toString("base64");
  return { ...unsigned, signature };
}

function coverageEqual(left: readonly AttestationReceiptCoverage[], right: readonly AttestationReceiptCoverage[]): boolean {
  try {
    return stableJson(normalizedCoverage(left)) === stableJson(normalizedCoverage(right));
  } catch {
    return false;
  }
}

export function verifyAdmissionAttestation(input: AttestationVerificationInput): AttestationVerification {
  const reasons: string[] = [];
  const value = input.attestation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, reasonCodes: ["malformed_schema"] };
  const candidate = value as Partial<AdmissionAttestation>;
  if (candidate.schemaVersion !== ADMISSION_ATTESTATION_SCHEMA_VERSION) reasons.push("unsupported_schema");
  if (candidate.algorithm !== ADMISSION_SIGNATURE_ALGORITHM) reasons.push("unsupported_algorithm");
  if (candidate.authorityKeyId !== input.authority.keyId) reasons.push("authority_mismatch");
  if (candidate.subjectDigest !== input.expectedSubjectDigest) reasons.push("subject_mismatch");
  if (candidate.baseCommit !== undefined && input.expectedBaseCommit !== undefined && candidate.baseCommit !== input.expectedBaseCommit.toLowerCase()) reasons.push("base_mismatch");
  if (candidate.headCommit !== undefined && input.expectedHeadCommit !== undefined && candidate.headCommit !== input.expectedHeadCommit.toLowerCase()) reasons.push("head_mismatch");
  if (!validDigest(candidate.subjectDigest)) reasons.push("invalid_subject_digest");
  if (typeof candidate.repositoryIdentity !== "string" || candidate.repositoryIdentity.length === 0) reasons.push("invalid_repository_identity");
  if (typeof candidate.issuedAt !== "string" || Number.isNaN(Date.parse(candidate.issuedAt))) reasons.push("invalid_issue_time");
  if (candidate.expiresAt !== undefined && (typeof candidate.expiresAt !== "string" || Number.isNaN(Date.parse(candidate.expiresAt)))) reasons.push("invalid_expiry");
  if (!Array.isArray(candidate.coveredReceipts)) reasons.push("invalid_coverage");
  if (typeof candidate.signature !== "string" || candidate.signature.length === 0) reasons.push("missing_signature");
  if (reasons.length > 0) return { valid: false, reasonCodes: [...new Set(reasons)] };
  let coverage: AttestationReceiptCoverage[];
  try {
    coverage = normalizedCoverage(candidate.coveredReceipts!);
  } catch {
    return { valid: false, reasonCodes: ["invalid_coverage"] };
  }
  if (!coverageEqual(coverage, input.expectedCoverage)) reasons.push("coverage_mismatch");
  const now = Date.parse(input.now ?? new Date().toISOString());
  const issuedAt = Date.parse(candidate.issuedAt!);
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(now) || !Number.isFinite(issuedAt) || issuedAt - now > 5 * 60 * 1_000) reasons.push("issue_time_in_future");
  if (Number.isFinite(now) && Number.isFinite(issuedAt) && now - issuedAt > maxAgeMs) reasons.push("stale_attestation");
  if (candidate.expiresAt !== undefined && Number.isFinite(now) && now > Date.parse(candidate.expiresAt)) reasons.push("expired_attestation");
  const unsigned = { ...candidate } as AdmissionAttestation;
  delete (unsigned as { signature?: string }).signature;
  let signatureValid = false;
  try {
    signatureValid = verify(null, Buffer.from(attestationPayload(unsigned), "utf8"), createPublicKey(input.authority.publicKeyPem), Buffer.from(candidate.signature!, "base64"));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) reasons.push("signature_invalid");
  return { valid: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}
