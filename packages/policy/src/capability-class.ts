/** Operation-class policy for workspace policy modes. */
import type { CapabilityClass, WorkspacePolicyMode } from "@my-pi/contracts";

export function classAllowedInMode(cls: CapabilityClass, mode: WorkspacePolicyMode): boolean {
  if (cls === "read") return true;
  if (cls === "write") return mode === "workspace-write" || mode === "review-required";
  return false;
}

export const V1_UNAVAILABLE_CLASSES: ReadonlySet<CapabilityClass> = new Set([
  "network",
  "exec",
  "debug",
  "secret",
]);
