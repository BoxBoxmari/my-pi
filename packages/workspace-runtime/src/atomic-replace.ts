import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { err, fingerprintBytes } from "@ccr/contracts";

export interface AtomicReplaceOptions {
  maxRetries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

export interface AtomicReplaceResult {
  committedBytes: Uint8Array;
  digest: string;
  size: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(err.aborted("aborted during atomic replace retry"));
        },
        { once: true },
      );
    }
  });
}

export async function atomicReplaceBytes(
  target: string,
  bytes: Uint8Array,
  opts: AtomicReplaceOptions = {},
): Promise<AtomicReplaceResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = opts.backoffMs ?? 20;
  const dir = path.dirname(target);
  const base = path.basename(target);
  const temp = path.join(dir, `.${base}.ccr-tmp-${randomBytes(6).toString("hex")}`);

  let attempts = 0;
  // P0.9: capture existing file mode before creating the temp file so
  // atomic replacement preserves permission/mode bits (executable scripts
  // stay executable).
  let mode: number | undefined;
  try {
    const st = await fs.stat(target);
    mode = st.mode & 0o7777;
  } catch {
    // New file: default mode from open() below.
  }
  for (;;) {
    try {
      const fh = await fs.open(temp, "wx", 0o644);
      try {
        await fh.writeFile(bytes);
        await fh.sync();
      } finally {
        await fh.close();
      }
      if (mode !== undefined) {
        await fs.chmod(temp, mode).catch(() => undefined);
      }
      await fs.rename(temp, target);
      break;
    } catch (e) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      const code = (e as NodeJS.ErrnoException).code;
      const transientBusy = code === "EBUSY" || code === "EPERM" || code === "EACCES";
      if (!transientBusy) {
        throw err.atomicReplaceFailed(`atomic replace failed: ${target} (${code ?? "unknown"})`);
      }
      attempts++;
      if (attempts > maxRetries) {
        throw err.fileBusy(`file is busy after ${maxRetries} retries: ${target}`);
      }
      await delay(backoffMs * attempts, opts.signal);
    }
  }

  const committed = await fs.readFile(target);
  const fp = fingerprintBytes(committed);
  const expected = fingerprintBytes(bytes);
  if (fp.digest !== expected.digest) {
    throw err.atomicReplaceFailed("committed bytes did not verify");
  }
  return { committedBytes: committed, digest: fp.digest, size: fp.size };
}

export function atomicReplacePlatform(): { platform: string; retrySupported: boolean } {
  return { platform: process.platform, retrySupported: true };
}
