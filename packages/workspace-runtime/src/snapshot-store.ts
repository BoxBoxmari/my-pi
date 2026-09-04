import {
  createSnapshotId,
  err,
  type FileFingerprint,
  type FileSnapshotRef,
  type NewlineStyle,
  type SnapshotId,
  type TextEncoding,
} from "@my-pi/contracts";

export interface RecordSnapshotInput {
  path: string;
  fingerprint: FileFingerprint;
  encoding: TextEncoding;
  bom: boolean;
  newline: NewlineStyle;
  finalNewline: boolean;
  workspaceRevision: number;
}

export interface SnapshotPrunePolicy {
  maxMetadata: number;
  retainPinned?: boolean;
}

export interface SnapshotPruneResult {
  metadataRemoved: number;
  contentRemoved: number;
}

export class SnapshotStore {
  private readonly byId = new Map<SnapshotId, FileSnapshotRef>();
  private readonly latestByPath = new Map<string, SnapshotId>();
  private readonly content = new Map<SnapshotId, Uint8Array>();
  private readonly pins = new Map<SnapshotId, Set<string>>();
  private bytesHeld = 0;

  constructor(private readonly maxCacheBytes = 16 * 1024 * 1024) {}

  record(input: RecordSnapshotInput): FileSnapshotRef {
    this.evictIfNeeded(input.fingerprint.size);
    const id = createSnapshotId();
    const ref: FileSnapshotRef = { id, ...input };
    this.byId.set(id, ref);
    this.latestByPath.set(input.path, id);
    return ref;
  }

  cacheContent(id: SnapshotId, bytes: Uint8Array): void {
    const previous = this.content.get(id);
    if (previous) this.bytesHeld -= previous.byteLength;
    if (bytes.byteLength > this.maxCacheBytes) {
      this.content.delete(id);
      return;
    }
    this.evictIfNeeded(bytes.byteLength);
    this.content.set(id, new Uint8Array(bytes));
    this.bytesHeld += bytes.byteLength;
  }

  resolve(idOrAnchor: string): FileSnapshotRef {
    if (this.byId.has(idOrAnchor as SnapshotId)) {
      return this.byId.get(idOrAnchor as SnapshotId)!;
    }
    if (this.latestByPath.has(idOrAnchor)) {
      const sid = this.latestByPath.get(idOrAnchor)!;
      return this.byId.get(sid)!;
    }
    const matches = [...this.byId.values()].filter((r) =>
      r.fingerprint.digest.toUpperCase().startsWith(idOrAnchor.toUpperCase()),
    );
    if (matches.length === 0) throw err.pathNotFound(`no snapshot for: ${idOrAnchor}`);
    if (matches.length > 1) throw err.ambiguousAnchor(`short anchor is ambiguous: ${idOrAnchor}`);
    return matches[0]!;
  }

  resolveAnchor(anchor: string): FileSnapshotRef {
    const matches = [...this.byId.values()].filter((r) =>
      r.fingerprint.digest.toUpperCase().startsWith(anchor.toUpperCase()),
    );
    if (matches.length === 0) throw err.pathNotFound(`no snapshot for anchor: ${anchor}`);
    if (matches.length > 1) throw err.ambiguousAnchor(`short anchor is ambiguous: ${anchor}`);
    return matches[0]!;
  }

  getContent(id: SnapshotId): Uint8Array | undefined {
    return this.content.get(id);
  }

  latestFor(path: string): FileSnapshotRef | undefined {
    const sid = this.latestByPath.get(path);
    return sid ? this.byId.get(sid) : undefined;
  }

  invalidate(path: string): void {
    this.latestByPath.delete(path);
  }

  pin(id: SnapshotId, ownerRef: string): void {
    if (!this.byId.has(id)) throw err.pathNotFound(`no snapshot for: ${id}`);
    if (!ownerRef || ownerRef.length > 256) throw err.invalidArgument("snapshot pin owner is required and bounded");
    const owners = this.pins.get(id) ?? new Set<string>();
    owners.add(ownerRef);
    this.pins.set(id, owners);
  }

  unpin(id: SnapshotId, ownerRef: string): void {
    const owners = this.pins.get(id);
    if (!owners) return;
    owners.delete(ownerRef);
    if (owners.size === 0) this.pins.delete(id);
  }

  prune(policy: SnapshotPrunePolicy): SnapshotPruneResult {
    if (!Number.isSafeInteger(policy.maxMetadata) || policy.maxMetadata < 0) throw err.invalidArgument("maxMetadata must be a non-negative safe integer");
    const latest = new Set(this.latestByPath.values());
    let metadataRemoved = 0;
    for (const [id] of this.byId) {
      if (this.byId.size <= policy.maxMetadata) break;
      if (latest.has(id) || (policy.retainPinned !== false && this.pins.has(id))) continue;
      this.byId.delete(id);
      this.pins.delete(id);
      const bytes = this.content.get(id);
      if (bytes) this.bytesHeld -= bytes.byteLength;
      this.content.delete(id);
      metadataRemoved++;
    }
    let contentRemoved = 0;
    for (const [id, bytes] of this.content) {
      if (this.pins.has(id) || this.byId.has(id)) continue;
      this.content.delete(id);
      this.bytesHeld -= bytes.byteLength;
      contentRemoved++;
    }
    return { metadataRemoved, contentRemoved };
  }

  size(): number {
    return this.byId.size;
  }

  private evictIfNeeded(incomingBytes: number): void {
    while (this.bytesHeld + incomingBytes > this.maxCacheBytes && this.content.size > 0) {
      const first = this.content.keys().next().value as SnapshotId | undefined;
      if (first === undefined) break;
      const b = this.content.get(first);
      if (b) this.bytesHeld -= b.byteLength;
      this.content.delete(first);
    }
  }
}
