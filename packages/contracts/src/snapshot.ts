/** File snapshot metadata. Metadata + optional cached content, NOT a journal. */
import type { SnapshotId } from "./ids.js";
import type { FileFingerprint } from "./fingerprint.js";
import type { TextEncoding, NewlineStyle } from "./encoding.js";

export interface FileSnapshotRef {
  id: SnapshotId;
  path: string;
  fingerprint: FileFingerprint;
  encoding: TextEncoding;
  bom: boolean;
  newline: NewlineStyle;
  finalNewline: boolean;
  workspaceRevision: number;
}
