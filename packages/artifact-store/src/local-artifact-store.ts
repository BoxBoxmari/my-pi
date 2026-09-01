import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createArtifactId,
  fingerprintBytes,
  type ArtifactId,
  type ArtifactRef,
} from "@ccr/contracts";

export interface ArtifactStore {
  put(mimeType: string, bytes: Uint8Array, expiresAtMs?: number): Promise<ArtifactRef>;
  read(ref: ArtifactRef): Promise<Uint8Array | undefined>;
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly dir: string;
  private readonly refs = new Map<ArtifactId, ArtifactRef>();

  constructor(dir: string, private readonly maxBytes = 64 * 1024 * 1024) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async put(mimeType: string, bytes: Uint8Array, expiresAtMs?: number): Promise<ArtifactRef> {
    const fp = fingerprintBytes(bytes);
    const id = createArtifactId();
    const ref: ArtifactRef = {
      id,
      mimeType,
      bytes: fp.size,
      sha256: fp.digest,
      expiresAt: expiresAtMs === undefined ? undefined : new Date(expiresAtMs).toISOString(),
    };
    const file = path.join(this.dir, `${id}.bin`);
    await fs.writeFile(file, bytes);
    this.refs.set(id, ref);
    return ref;
  }

  async read(ref: ArtifactRef): Promise<Uint8Array | undefined> {
    if (ref.expiresAt && Date.parse(ref.expiresAt) < Date.now()) return undefined;
    const file = path.join(this.dir, `${ref.id}.bin`);
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch {
      return undefined;
    }
  }
}
