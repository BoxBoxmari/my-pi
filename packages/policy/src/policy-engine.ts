/**
 * Policy engine: authorize an operation class for a resolved path against a
 * workspace policy, applying sensitive-path deny-by-default semantics.
 */
import type { CapabilityClass, WorkspacePolicy } from "@my-pi/contracts";
import { classAllowedInMode, V1_UNAVAILABLE_CLASSES } from "./capability-class.js";
import { SensitivePathPolicy } from "./sensitive-paths.js";

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: "mode-denied" | "secret-path-denied" | "unavailable-class" };

export class PolicyEngine {
  private readonly sensitive: SensitivePathPolicy;

  constructor(sensitive: SensitivePathPolicy = new SensitivePathPolicy()) {
    this.sensitive = sensitive;
  }

  authorize(policy: WorkspacePolicy, cls: CapabilityClass, relPosixPath: string): PolicyVerdict {
    if (V1_UNAVAILABLE_CLASSES.has(cls)) {
      return { allowed: false, reason: "unavailable-class" };
    }
    if (!classAllowedInMode(cls, policy.mode)) {
      return { allowed: false, reason: "mode-denied" };
    }
    if (cls === "read" || cls === "write") {
      const rule = this.sensitive.isSensitive(relPosixPath);
      if (rule !== undefined) {
        const allowed = policy.allowedSensitivePaths.some((allowedPath) => {
          const normalized = allowedPath.replace(/\/+$/, "");
          return relPosixPath === normalized || relPosixPath.startsWith(normalized + "/");
        });
        if (!allowed) return { allowed: false, reason: "secret-path-denied" };
      }
    }
    return { allowed: true };
  }
}
