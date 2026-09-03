/** Workspace, policy, and capability metadata. */
import type { WorkspaceId } from "./ids.js";

export type CapabilityClass = "read" | "write" | "network" | "exec" | "debug" | "secret";

export type WorkspacePolicyMode = "read-only" | "workspace-write" | "review-required";

export interface WorkspacePolicy {
  mode: WorkspacePolicyMode;
  /** Allow-listed sensitive paths, configured externally (never by a model tool argument). */
  allowedSensitivePaths: string[];
}

export interface WorkspaceCapabilities {
  read: boolean;
  write: boolean;
  search: boolean;
  ast: boolean;
  lsp: boolean;
  vcs: boolean;
}

export interface Workspace {
  id: WorkspaceId;
  /** Normalized absolute root. */
  root: string;
  additionalRoots: string[];
  revision: number;
  policy: WorkspacePolicy;
  capabilities: WorkspaceCapabilities;
}

export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  mode: "read-only",
  allowedSensitivePaths: [],
};
