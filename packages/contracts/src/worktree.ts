import type { RepositoryId, WorktreeId } from "./ids.js";

/** A specific checkout or isolated agent workspace. */
export interface Worktree {
  id: WorktreeId;
  repositoryId: RepositoryId;
  /** Normalized absolute workspace root. */
  root: string;
  head?: string;
  branch?: string;
  observedAt: string;
}
