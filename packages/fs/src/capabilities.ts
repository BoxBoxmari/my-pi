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
  type FileFingerprint,
} from "@my-pi/contracts";
import { type WorkspaceRuntime } from "@my-pi/workspace-runtime";
import { applyHunks, parsePatch } from "@my-pi/hashline";
import { ChangeRuntime, type ResourcePrecondition } from "@my-pi/change-runtime";
import { BoundedReadError, DEFAULT_FS_READ_BYTES, MAX_FS_READ_BYTES, MAX_FS_WRITE_BYTES, readBoundedFile } from "./bounded-read.js";

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
  const changeRuntime = new ChangeRuntime(runtime);

  map.set("fs_stat", {
    name: "fs_stat",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: p } = input as { path: string };
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
      const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const st = await fs.stat(authorized.absolute);
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
      // G2 output budget: byte-oriented window over the file. The bounded
      // reader also keeps the full-file hash and metadata streaming.
      const { path: p, offset = 0, max_bytes } = input as {
        path: string;
        offset?: number;
        max_bytes?: number;
      };
      const windowBytes = max_bytes !== undefined ? max_bytes : DEFAULT_FS_READ_BYTES;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(windowBytes) || windowBytes <= 0 || windowBytes > MAX_FS_READ_BYTES) {
        throw err.invalidArgument(`offset must be >=0 and max_bytes must be between 1 and ${MAX_FS_READ_BYTES}`);
      }

      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
      const authorized = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      let bounded;
      try {
        bounded = await readBoundedFile(authorized.absolute, offset, windowBytes);
      } catch (e) {
        if (e instanceof RangeError) throw err.invalidArgument(e.message);
        if (e instanceof BoundedReadError && e.kind === "binary") throw err.binaryFile(`binary file: ${resolved.relPosix}`);
        if (e instanceof BoundedReadError && e.kind === "encoding") throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
        throw e;
      }

      const fp = { algorithm: "sha256" as const, digest: bounded.digest, size: bounded.size };
      const snapshot = runtime.snapshots.record({
        path: resolved.relPosix,
        fingerprint: fp,
        encoding: bounded.encoding,
        bom: bounded.bom,
        newline: bounded.newline,
        finalNewline: bounded.finalNewline,
        workspaceRevision: ctx.workspace.revision,
      });

      return result(ctx, {
        path: resolved.relPosix,
        snapshot_id: snapshot.id,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        encoding: bounded.encoding,
        newline: bounded.newline,
        finalNewline: bounded.finalNewline,
        size: fp.size,
        offset: Math.min(offset, fp.size),
        content_offset: bounded.contentOffset,
        max_bytes: windowBytes,
        truncated: bounded.nextOffset !== undefined,
        next_offset: bounded.nextOffset,
        content_bytes: bounded.contentBytes,
        content: bounded.content,
      }, t0);
    },
  });

  map.set("fs_write", {
    name: "fs_write",
    risk: "write",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { path: p, content, expected_hash } = input as { path: string; content: string; expected_hash?: string };
      if (typeof content !== "string") throw err.invalidArgument("content must be a string");
      if (Buffer.byteLength(content, "utf8") > MAX_FS_WRITE_BYTES) {
        throw err.outputLimit(`fs_write content exceeds ${MAX_FS_WRITE_BYTES} bytes`);
      }
      const resolved = await runtime.pathPolicy.resolveForWrite(ctx.workspace, p);
      let detected = detectEncoding(new Uint8Array());
      let existed = false;
      let currentFingerprint: FileFingerprint | undefined;
      try {
        const existing = new Uint8Array(await fs.readFile(resolved.absolute));
        existed = true;
        if (isLikelyBinary(existing) === false) detected = detectEncoding(existing);
        currentFingerprint = fingerprintBytes(existing);
        // P0.8: existing-file overwrite REQUIRES expected_hash.
        if (expected_hash === undefined) throw err.staleResource(`fs_write on existing file requires expected_hash (read the file first): ${resolved.relPosix}`);
        if (!digestMatches(expected_hash, currentFingerprint.digest)) throw err.staleResource(`stale write for ${resolved.relPosix}`);
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_STALE_RESOURCE") throw e;
        const nodeCode = (e as NodeJS.ErrnoException).code;
        if (nodeCode !== "ENOENT") throw e;
      }
      const precondition: ResourcePrecondition = existed && currentFingerprint
        ? { path: resolved.relPosix, condition: "match", fingerprint: currentFingerprint }
        : { path: resolved.relPosix, condition: "absent" };
      await changeRuntime.applyBytes({ path: resolved.relPosix, bytes: encodeText(content, detected.encoding), precondition, signal: ctx.signal });
      const afterResolved = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const after = new Uint8Array(await fs.readFile(afterResolved.absolute));
      const fp = fingerprintBytes(after);
      const afterDetected = detectEncoding(after);
      let afterText: string;
      try {
        afterText = decodeText(after, afterDetected);
      } catch {
        throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
      }
      const snap = runtime.snapshots.record({
        path: resolved.relPosix,
        fingerprint: fp,
        encoding: afterDetected.encoding,
        bom: afterDetected.bom,
        newline: detectNewline(afterText),
        finalNewline: hasFinalNewline(afterText),
        workspaceRevision: ctx.workspace.revision,
      });
      return result(ctx, {
        path: resolved.relPosix,
        snapshot_id: snap.id,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        size: fp.size,
        encoding: afterDetected.encoding,
        newline: detectNewline(afterText),
        finalNewline: hasFinalNewline(afterText),
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
      let raw: Uint8Array;
      try {
        raw = new Uint8Array(await fs.readFile(resolved.absolute));
      } catch {
        throw err.pathNotFound(`path not found: ${p}`);
      }
      if (isLikelyBinary(raw)) throw err.binaryFile(`binary file: ${resolved.relPosix}`);
      const initialFingerprint = fingerprintBytes(raw);
      if (!digestMatches(expected_hash, initialFingerprint.digest)) throw err.staleResource(`stale patch for ${resolved.relPosix}`);
      const precondition: ResourcePrecondition = { path: resolved.relPosix, condition: "match", fingerprint: initialFingerprint };
      const receipt = await changeRuntime.applyTransform({
        path: resolved.relPosix,
        precondition,
        signal: ctx.signal,
        transform: (current) => {
          const detected = detectEncoding(current);
          let text: string;
          try {
            text = decodeText(current, detected);
          } catch {
            throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
          }
          return encodeText(applyHunks(text, parsed.hunks), detected.encoding);
        },
      });
      const newDigest = receipt.outputVersions?.[0]?.fingerprint?.digest ?? "";
      const afterResolved = await runtime.pathPolicy.revalidate(ctx.workspace, resolved, "read");
      const after = new Uint8Array(await fs.readFile(afterResolved.absolute));
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
