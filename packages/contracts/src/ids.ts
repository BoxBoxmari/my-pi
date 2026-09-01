/**
 * Opaque, branded identifier types. Explicit application state uses these IDs;
 * no application correctness may depend on transport connection identity or
 * Mcp-Session-Id (architecture invariant).
 */
import { randomUUID } from "node:crypto";

declare const workspaceIdBrand: unique symbol;
declare const snapshotIdBrand: unique symbol;
declare const artifactIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;

export type WorkspaceId = string & { [workspaceIdBrand]: true };
export type SnapshotId = string & { [snapshotIdBrand]: true };
export type ArtifactId = string & { [artifactIdBrand]: true };
export type RequestId = string & { [requestIdBrand]: true };

export function createWorkspaceId(): WorkspaceId {
  return `ws_${randomUUID().replaceAll("-", "").slice(0, 12)}` as WorkspaceId;
}

export function createSnapshotId(): SnapshotId {
  return `snap_${randomUUID().replaceAll("-", "").slice(0, 12)}` as SnapshotId;
}

export function createArtifactId(): ArtifactId {
  return `art_${randomUUID().replaceAll("-", "").slice(0, 12)}` as ArtifactId;
}

export function createRequestId(): RequestId {
  return `req_${randomUUID().replaceAll("-", "").slice(0, 12)}` as RequestId;
}
