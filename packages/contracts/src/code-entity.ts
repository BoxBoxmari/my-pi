import type { CodeEntityId, ProjectId, RepositoryId, WorktreeId } from "./ids.js";
import type { FileFingerprint } from "./fingerprint.js";

export type CodeEntityKind = "repository" | "module" | "file" | "symbol" | "test";

export interface CodeEntity {
  id: CodeEntityId;
  projectId: ProjectId;
  repositoryId: RepositoryId;
  worktreeId?: WorktreeId;
  kind: CodeEntityKind;
  stableKey: string;
  displayName: string;
  path?: string;
  symbolKind?: string;
  fingerprint?: FileFingerprint;
  observedAt: string;
  provider: "fs" | "ast" | "lsp" | "vcs";
}

export type CodeEdgeKind = "contains" | "imports" | "references" | "calls" | "tests";
export type CodeEdgeConfidence = "exact" | "strong" | "medium" | "weak";

export interface CodeEdge {
  from: CodeEntityId;
  to: CodeEntityId;
  kind: CodeEdgeKind;
  confidence: CodeEdgeConfidence;
  provider: string;
  observedAt: string;
}
