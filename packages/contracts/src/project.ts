import type { ProjectId } from "./ids.js";
import type { PolicyRef } from "./principal.js";

/** Logical software product/workspace coordination boundary. */
export interface Project {
  id: ProjectId;
  schemaVersion: "1";
  displayName?: string;
  createdAt: string;
  policyRef?: PolicyRef;
}
