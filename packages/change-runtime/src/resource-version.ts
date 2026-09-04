import { fingerprintBytes, type FileFingerprint, type ResourceVersion } from "@my-pi/contracts";

export type ResourcePrecondition =
  | { path: string; condition: "match"; fingerprint: FileFingerprint }
  | { path: string; condition: "absent" };

export function versionFromBytes(path: string, bytes: Uint8Array): ResourceVersion {
  return { path, fingerprint: fingerprintBytes(bytes), absent: false };
}

export function matchesPrecondition(precondition: ResourcePrecondition, current: Uint8Array | undefined): boolean {
  if (precondition.condition === "absent") return current === undefined;
  if (current === undefined) return false;
  return fingerprintBytes(current).digest === precondition.fingerprint.digest && fingerprintBytes(current).size === precondition.fingerprint.size;
}
