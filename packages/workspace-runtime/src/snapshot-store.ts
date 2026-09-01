import {
  createSnapshotId,
  err,
  type FileFingerprint,
  type FileSnapshotRef,
  type NewlineStyle,
  type SnapshotId,
  type TextEncoding,
} from "@ccr/contracts";

export interface RecordSnapshotInput {
  path: string;
  fingerprint: FileFingerprint;
  encoding: TextEncoding;
  bom: boolean;
  newline: NewlineStyle;
  finalNewline: boolean;
  workspaceRevision: number;
}

export class SnapshotStore {
  private readonly byId = new Map<SnapshotId, FileSnapshotRef>();
  private readonly byPath = new Map<string, SnapshotId>();
  private readonly content = new Map<SnapshotId, Uint8Array>();
  private bytesHeld = 0;

  constructor(private readonly maxCacheBytes = 16 * 1024 * 1024) {}

  record(input: RecordSnapshotInput): FileSnapshotRef {
    this.evictIfNeeded(input.fingerprint.size);
    const id = createSnapshotId();
    const ref: FileSnapshotRef = { id, ...input };
    this.byId.set(id, ref);
    const prev = this.byPath.get(input.path);
    if (prev) this.byId.delete(prev);
    this.byPath.set(input.path, id);
    return ref;
  }

  cacheContent(id: SnapshotId, bytes: Uint8Array): void {
    this.evictIfNeeded(bytes.byteLength);
    this.content.set(id, bytes);
    this.bytesHeld += bytes.byteLength;
  }

  resolve(idOrAnchor: string): FileSnapshotRef {
    if (this.byId.has(idOrAnchor as SnapshotId)) {
      return this.byId.get(idOrAnchor as SnapshotId)!;
    }
    if (this.byPath.has(idOrAnchor)) {
      const sid = this.byPath.get(idOrAnchor)!;
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
    const sid = this.byPath.get(path);
    return sid ? this.byId.get(sid) : undefined;
  }

  invalidate(path: string): void {
    const sid = this.byPath.get(path);
    if (sid) {
      this.byPath.delete(path);
      this.byId.delete(sid);
      const bytes = this.content.get(sid);
      if (bytes) this.bytesHeld -= bytes.byteLength;
      this.content.delete(sid);
    }
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
