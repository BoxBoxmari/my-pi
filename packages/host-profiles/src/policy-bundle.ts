import type { HostProfile } from "./profile.js";
import { renderProfile, type RenderOptions, type RenderedConfig } from "./render.js";

export type EnforcementMaturity = "strict-capable" | "managed" | "monitoring";
export type HostBypassVector = "native-edit" | "shell-redirection" | "scripted-write" | "alternate-mcp-filesystem" | "direct-git-patch";

export interface HostBypassResult {
  vector: HostBypassVector;
  blocked: boolean;
  evidenceRef?: string;
  residualPath?: string;
}

export interface HostBypassAssessment {
  passed: boolean;
  missingVectors: HostBypassVector[];
  residualPaths: string[];
}

export interface HostPolicyBundleOptions extends RenderOptions {
  maturity?: EnforcementMaturity;
  strictCandidate?: boolean;
  knownUnenforcedPaths?: readonly string[];
  verificationExceptions?: readonly string[];
  bypassResults?: readonly HostBypassResult[];
}

export interface HostPolicyBundle {
  schemaVersion: "my-pi/host-policy-bundle/v1";
  bundleId: string;
  profileId: string;
  maturity: EnforcementMaturity;
  certification: "candidate" | "uncertified" | "strict-certified";
  mcpConfig: RenderedConfig;
  enforcement: {
    nativeEdit: "deny" | "monitor";
    shellMutation: "deny" | "monitor";
    alternateMcpFilesystem: "deny" | "monitor";
    directGitPatch: "admission-only";
  };
  knownUnenforcedPaths: string[];
  verificationExceptions: string[];
  bypassAssessment: HostBypassAssessment;
}

export const REQUIRED_BYPASS_VECTORS: readonly HostBypassVector[] = [
  "native-edit",
  "shell-redirection",
  "scripted-write",
  "alternate-mcp-filesystem",
  "direct-git-patch",
];

export function assessHostBypass(results: readonly HostBypassResult[]): HostBypassAssessment {
  const byVector = new Map(results.map((result) => [result.vector, result] as const));
  const missingVectors = REQUIRED_BYPASS_VECTORS.filter((vector) => byVector.get(vector)?.blocked !== true);
  const residualPaths = [...new Set(results.flatMap((result) => result.residualPath === undefined ? [] : [result.residualPath]))].sort();
  return { passed: missingVectors.length === 0 && residualPaths.length === 0, missingVectors, residualPaths };
}

export function renderPolicyBundle(profile: HostProfile, options: HostPolicyBundleOptions): HostPolicyBundle {
  const maturity = options.maturity ?? (options.strictCandidate ? "strict-capable" : "monitoring");
  if (options.strictCandidate && maturity !== "strict-capable") throw new Error("strict candidate must use strict-capable maturity");
  const bypassAssessment = assessHostBypass(options.bypassResults ?? []);
  const knownUnenforcedPaths = [...new Set(options.knownUnenforcedPaths ?? (options.strictCandidate ? ["bypass-suite-not-run"] : ["host-native-edit", "host-shell-redirection", "alternate-mcp-filesystem"]))].sort();
  const certification = options.strictCandidate
    ? (bypassAssessment.passed && knownUnenforcedPaths.length === 0 ? "strict-certified" : "candidate")
    : "uncertified";
  return {
    schemaVersion: "my-pi/host-policy-bundle/v1",
    bundleId: `${profile.id}:policy-v1`,
    profileId: profile.id,
    maturity,
    certification,
    mcpConfig: renderProfile(profile, options),
    enforcement: {
      nativeEdit: maturity === "strict-capable" ? "deny" : "monitor",
      shellMutation: maturity === "strict-capable" ? "deny" : "monitor",
      alternateMcpFilesystem: maturity === "strict-capable" ? "deny" : "monitor",
      directGitPatch: "admission-only",
    },
    knownUnenforcedPaths,
    verificationExceptions: [...new Set(options.verificationExceptions ?? ["read-only verification commands"])].sort(),
    bypassAssessment,
  };
}
