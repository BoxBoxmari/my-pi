/** Raw-byte file fingerprint. Raw bytes are authoritative (A11). */
import { createHash } from "node:crypto";

export interface FileFingerprint {
  algorithm: "sha256";
  digest: string;
  size: number;
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fingerprintBytes(bytes: Uint8Array): FileFingerprint {
  return { algorithm: "sha256", digest: computeSha256(bytes), size: bytes.byteLength };
}

/** Short display anchor derived from the full digest (uppercase hex prefix). */
export function shortAnchor(digest: string, length = 12): string {
  return digest.slice(0, length).toUpperCase();
}

export function fingerprintsEqual(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.algorithm === b.algorithm && a.digest === b.digest && a.size === b.size;
}
