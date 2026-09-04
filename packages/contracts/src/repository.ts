import type { ProjectId, RepositoryId } from "./ids.js";

export type RepositoryVcs = "git";

/** Logical VCS repository independent of a checkout path. */
export interface Repository {
  id: RepositoryId;
  projectId: ProjectId;
  vcs: RepositoryVcs;
  /** Local stable identity; this need not be a remote URL. */
  canonicalIdentity: string;
}
