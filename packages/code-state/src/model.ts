import type { CodeEdge, CodeEntity } from "@my-pi/contracts";
import type { ProjectId, RepositoryId, WorktreeId } from "@my-pi/contracts";

export interface AuthorizedReadPath {
  absolute: string;
  relPosix: string;
  exists: boolean;
}

export interface IndexContext {
  projectId: ProjectId;
  repositoryId: RepositoryId;
  worktreeId: WorktreeId;
  repositoryIdentity: string;
  root: string;
  signal: AbortSignal;
  /** Server-provided containment and sensitive-path check for every read. */
  resolveReadPath: (filePath: string) => Promise<AuthorizedReadPath>;
}

export interface CodeGraphDelta {
  provider: string;
  changedPath: string;
  entities: CodeEntity[];
  edges: CodeEdge[];
  removedStableKeys: string[];
  observedAt: string;
  providerHealth: Record<string, { status: string; message?: string }>;
}

export interface CodeGraphSnapshot {
  entities: CodeEntity[];
  edges: CodeEdge[];
}
