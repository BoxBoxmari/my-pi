/** Artifact reference for large/binary results spilled out of inline output. */
import type { ArtifactId } from "./ids.js";

export interface ArtifactRef {
  id: ArtifactId;
  mimeType: string;
  bytes: number;
  sha256: string;
  /** ISO timestamp or undefined for default retention. */
  expiresAt?: string;
}
