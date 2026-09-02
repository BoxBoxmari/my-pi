/**
 * @my-pi/fs — the FS capability package (P1.1).
 *
 * Owns fs_read / fs_stat / fs_write / fs_patch business logic. The MCP
 * adapter only translates MCP input into domain input and back.
 */
import { promises as fs } from "node:fs";
import {
  err,
  fingerprintBytes,
  shortAnchor,
  detectEncoding,
  decodeText,
  encodeText,
  detectNewline,
  hasFinalNewline,
  isLikelyBinary,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@my-pi/contracts";
import { atomicCreateNoReplace, atomicReplaceBytes, type WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { applyHunks, parsePatch } from "@my-pi/hashline";

type Ctx = CapabilityContext;

function result<T>(
  ctx: Ctx,
  data: T,
  startedAt: number,
  extra?: Partial<Pick<CapabilityResult<T>, "backend" | "degraded" | "warnings" | "artifacts">>,
): CapabilityResult<T> {
  const totalMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs },
    ...extra,
  };
}

function digestMatches(expected: string, digest: string): boolean {
  const normalized = expected.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
  return normalized.toLowerCase() === digest.toLowerCase();
}

export function createFsCapabilities(runtime: WorkspaceRuntime): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();

  map.set("fs_stat", {
    name: "fs_stat",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: p } = input as { path: string };
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
      const st = await fs.stat(resolved.absolute);
      return result(ctx, {
        path: resolved.relPosix,
        exists: true,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      }, t0);
    },
  });

  map.set("fs_read", {
    name: "fs_read",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      // G2 output budget: optional window over the file. Default 48 KiB.
      const { path: p, offset = 0, max_bytes } = input as {
        path: string;
        offset?: number;
        max_bytes?: number;
      };
      const windowBytes = max_bytes !== undefined ? max_bytes : 48 * 1024;
      if (offset < 0 || windowBytes <= 0) throw err.invalidArgument("offset>=0 and max_bytes>0 required");

      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
      const raw = new Uint8Array(await fs.readFile(resolved.absolute));

      if (isLikelyBinary(raw)) throw err.binaryFile(`binary file: ${resolved.relPosix}`);

      const detected = detectEncoding(raw);
      let fullText: string;
      try {
        fullText = decodeText(raw, detected);
      } catch {
        throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
      }

      // Fingerprint + snapshot are over the FULL file (raw-byte authority),
      // never the window.
      const fp = fingerprintBytes(raw);
      const snapshot = runtime.snapshots.record({
        path: resolved.relPosix,
        fingerprint: fp,
        encoding: detected.encoding,
        bom: detected.bom,
        newline: detectNewline(fullText),
        finalNewline: hasFinalNewline(fullText),
        workspaceRevision: ctx.workspace.revision,
      });
      runtime.snapshots.cacheContent(snapshot.id, raw);

      // Window the decoded text by CHARACTER offset (not byte), bounded.
      const clampedOffset = Math.max(0, Math.min(offset, fullText.length));
      const window = fullText.slice(clampedOffset, clampedOffset + windowBytes);
      const truncated = clampedOffset + window.length < fullText.length;
      const nextOffset = truncated ? clampedOffset + window.length : undefined;

      return result(ctx, {
        path: resolved.relPosix,
        snapshot_id: snapshot.id,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        encoding: detected.encoding,
        newline: detectNewline(fullText),
        finalNewline: hasFinalNewline(fullText),
        size: fp.size,
        offset: clampedOffset,
        max_bytes: windowBytes,
        truncated,
        next_offset: nextOffset,
        content: window,
      }, t0);
    },
  });

  map.set("fs_write", {
    name: "fs_write",
    risk: "write",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: p, content, expected_hash } = input as { path: string; content: string; expected_hash?: string };
      const resolved = await runtime.pathPolicy.resolveForWrite(ctx.workspace, p);
      await runtime.mutatePath(resolved.relPosix, async () => {
        let detected = detectEncoding(new Uint8Array());
        let existed = false;
        try {
          const existing = new Uint8Array(await fs.readFile(resolved.absolute));
          existed = true;
          if (isLikelyBinary(existing) === false) {
            detected = detectEncoding(existing);
          }
          // P0.8: existing-file overwrite REQUIRES expected_hash.
          if (expected_hash === undefined) {
            throw err.staleResource(
              `fs_write on existing file requires expected_hash (read the file first): ${resolved.relPosix}`,
            );
          }
          if (!digestMatches(expected_hash, fingerprintBytes(existing).digest)) {
            throw err.staleResource(`stale write for ${resolved.relPosix}`);
          }
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_STALE_RESOURCE") throw e;
          const nodeCode = (e as NodeJS.ErrnoException).code;
          if (nodeCode !== "ENOENT" && existed === false) throw e;
        }
        // P0.8 (create): verify non-existence immediately before commit.
        if (!existed && expected_hash === undefined) {
          // R0.1.4: no-clobber atomic create — link() fails with EEXIST if a
          // target appeared since the read. This replaces the TOCTOU-prone
          // access()-then-rename flow.
          await atomicCreateNoReplace(resolved.absolute, encodeText(content, detected.encoding), { signal: ctx.signal });
          return;
        }
        const newBytes = encodeText(content, detected.encoding);
        await atomicReplaceBytes(resolved.absolute, newBytes, { signal: ctx.signal });
      });
      const after = new Uint8Array(await fs.readFile(resolved.absolute));
      const fp = fingerprintBytes(after);
      const snap = runtime.snapshots.record({
        path: resolved.relPosix,
        fingerprint: fp,
        encoding: detectEncoding(after).encoding,
        bom: detectEncoding(after).bom,
        newline: detectNewline(new TextDecoder().decode(after)),
        finalNewline: hasFinalNewline(new TextDecoder().decode(after)),
        workspaceRevision: ctx.workspace.revision,
      });
      runtime.snapshots.cacheContent(snap.id, after);
      return result(ctx, {
        path: resolved.relPosix,
        snapshot_id: snap.id,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        size: fp.size,
      }, t0, { backend: "typescript" });
    },
  });

  map.set("fs_patch", {
    name: "fs_patch",
    risk: "write",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      // R0.1.3: expected_hash is MANDATORY — fs_patch only operates on an
      // existing file the caller has observed, and CAS is required.
      const { path: p, patch, expected_hash } = input as {
        path: string;
        patch: { hunks: Array<{ old: string; new: string }> };
        expected_hash?: string;
      };
      if (expected_hash === undefined || expected_hash === "") {
        throw err.invalidArgument("fs_patch requires expected_hash (read the file first)");
      }
      const resolved = await runtime.pathPolicy.resolveForWrite(ctx.workspace, p);
      const parsed = parsePatch(patch);
      let newDigest = "";
      await runtime.mutatePath(resolved.relPosix, async () => {
        let raw: Uint8Array;
        try {
          raw = new Uint8Array(await fs.readFile(resolved.absolute));
        } catch {
          throw err.pathNotFound(`path not found: ${p}`);
        }
        if (isLikelyBinary(raw)) throw err.binaryFile(`binary file: ${resolved.relPosix}`);
        const detected = detectEncoding(raw);
        let text: string;
        try {
          text = decodeText(raw, detected);
        } catch {
          throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
        }
        const cur = fingerprintBytes(raw);
        if (!digestMatches(expected_hash, cur.digest)) {
          throw err.staleResource(`stale patch for ${resolved.relPosix}`);
        }
        const newText = applyHunks(text, parsed.hunks);
        const newBytes = encodeText(newText, detected.encoding);
        await atomicReplaceBytes(resolved.absolute, newBytes, { signal: ctx.signal });
        newDigest = fingerprintBytes(newBytes).digest;
      });
      const after = new Uint8Array(await fs.readFile(resolved.absolute));
      const fp = fingerprintBytes(after);
      return result(ctx, {
        path: resolved.relPosix,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        size: fp.size,
        committed_expected: newDigest === fp.digest,
      }, t0, { backend: "typescript" });
    },
  });

  return map;
}
