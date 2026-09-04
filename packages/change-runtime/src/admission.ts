import { err, fingerprintBytes } from "@my-pi/contracts";
import type { ResourcePrecondition } from "./resource-version.js";

export function assertPrecondition(precondition: ResourcePrecondition, current: Uint8Array | undefined): void {
  if (precondition.condition === "absent") {
    if (current !== undefined) throw err.staleResource(`target already exists: ${precondition.path}`);
    return;
  }
  if (current === undefined) throw err.staleResource(`target disappeared before publication: ${precondition.path}`);
  const observed = fingerprintBytes(current);
  if (observed.digest !== precondition.fingerprint.digest || observed.size !== precondition.fingerprint.size) {
    throw err.staleResource(`resource changed before publication: ${precondition.path}`);
  }
}
