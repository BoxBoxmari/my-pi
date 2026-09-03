import { createHash, randomBytes, type Hash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { createArtifactId, err, type ArtifactId, type ArtifactRef } from "@my-pi/contracts";

export interface ArtifactStore {
  put(mimeType: string, bytes: Uint8Array, expiresAtMs?: number): Promise<ArtifactRef>;
  createWriter(mimeType: string, expiresAtMs?: number): Promise<ArtifactWriter>;
  read(ref: ArtifactRef): Promise<Uint8Array | undefined>;
}

export interface ArtifactWriter {
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<ArtifactRef>;
  abort(): Promise<void>;
}

class LocalArtifactWriter implements ArtifactWriter {
  private readonly hash: Hash = createHash("sha256");
  private bytesWritten = 0;
  private closed = false;

  constructor(
    private readonly handle: FileHandle,
    private readonly tempPath: string,
    private readonly finalPath: string,
    private readonly id: ArtifactId,
    private readonly mimeType: string,
    private readonly expiresAt: string,
    private readonly maxBytes: number,
    private readonly onFinished: (ref: ArtifactRef) => void,
  ) {}

  async append(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("artifact writer is closed");
    if (this.bytesWritten + bytes.byteLength > this.maxBytes) {
      throw err.outputLimit(`artifact exceeds ${this.maxBytes} bytes`);
    }
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await this.handle.write(bytes, offset, bytes.byteLength - offset, null);
      if (bytesWritten <= 0) throw new Error("artifact writer made no progress");
      offset += bytesWritten;
    }
    this.hash.update(bytes);
    this.bytesWritten += bytes.byteLength;
  }

  async finish(): Promise<ArtifactRef> {
    if (this.closed) throw new Error("artifact writer is closed");
    try {
      await this.handle.sync();
      await this.handle.close();
      await fs.rename(this.tempPath, this.finalPath);
      this.closed = true;
      const ref: ArtifactRef = {
        id: this.id,
        mimeType: this.mimeType,
        bytes: this.bytesWritten,
        sha256: this.hash.digest("hex"),
        expiresAt: this.expiresAt,
      };
      this.onFinished(ref);
      return ref;
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close().catch(() => undefined);
    await fs.rm(this.tempPath, { force: true }).catch(() => undefined);
  }
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly dir: string;
  private readonly refs = new Map<ArtifactId, ArtifactRef>();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(dir: string, readonly maxBytes = 64 * 1024 * 1024) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.dir, 0o700).catch(() => undefined);
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpired().catch(() => undefined);
      }, 60_000);
      this.cleanupTimer.unref();
    }
  }

  async put(mimeType: string, bytes: Uint8Array, expiresAtMs?: number): Promise<ArtifactRef> {
    const writer = await this.createWriter(mimeType, expiresAtMs);
    try {
      await writer.append(bytes);
      return await writer.finish();
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }

  async createWriter(mimeType: string, expiresAtMs = Date.now() + 15 * 60 * 1000): Promise<ArtifactWriter> {
    await this.init();
    await this.cleanupExpired();
    const id = createArtifactId();
    const finalPath = path.join(this.dir, `${id}.bin`);
    const tempPath = path.join(this.dir, `.${id}.tmp-${randomBytes(6).toString("hex")}`);
    const handle = await fs.open(tempPath, "wx", 0o600);
    return new LocalArtifactWriter(
      handle,
      tempPath,
      finalPath,
      id,
      mimeType,
      new Date(expiresAtMs).toISOString(),
      this.maxBytes,
      (ref) => this.refs.set(ref.id, ref),
    );
  }

  async read(ref: ArtifactRef): Promise<Uint8Array | undefined> {
    await this.cleanupExpired();
    if (!/^art_[a-f0-9]{12}$/i.test(ref.id)) return undefined;
    if (ref.expiresAt && Date.parse(ref.expiresAt) < Date.now()) return undefined;
    const file = path.join(this.dir, `${ref.id}.bin`);
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== ref.bytes || digest !== ref.sha256) return undefined;
      return bytes;
    } catch {
      return undefined;
    }
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [id, ref] of this.refs) {
      if (!ref.expiresAt || Date.parse(ref.expiresAt) >= now) continue;
      await fs.rm(path.join(this.dir, `${id}.bin`), { force: true }).catch(() => undefined);
      this.refs.delete(id);
    }
  }
}
