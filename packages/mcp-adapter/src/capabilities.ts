/**
 * V1 capability implementations (G1 foundation subset).
 * Implemented: workspace_info, fs_stat, fs_read, fs_write, fs_patch, search, vcs_status, vcs_diff.
 * Present-but-unsupported until their gate: ast_search, lsp_*
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
} from "@ccr/contracts";
import { atomicReplaceBytes, type WorkspaceRuntime } from "@ccr/workspace-runtime";
import { applyHunks, parsePatch } from "@ccr/hashline";
import { NodeFallbackSearchBackend } from "@ccr/search";
import { GitVcsBackend } from "@ccr/vcs";
import { SensitivePathPolicy } from "@ccr/policy";

type Ctx = CapabilityContext;

function result<T>(
  ctx: Ctx,
  data: T,
  extra?: Partial<Pick<CapabilityResult<T>, "backend" | "degraded" | "warnings" | "artifacts">>,
): CapabilityResult<T> {
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs: 0 },
    ...extra,
  };
}

function unsupported(name: string): Capability<unknown, unknown> {
  return {
    name,
    risk: "read",
    async execute() {
      throw err.unsupportedCapability(`${name} is not implemented in the G1 foundation`);
    },
  };
}

function digestMatches(expected: string, digest: string): boolean {
  const normalized = expected.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
  return normalized.toLowerCase() === digest.toLowerCase();
}

export function createFoundationCapabilities(runtime: WorkspaceRuntime): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();

  map.set("workspace_info", {
    name: "workspace_info",
    risk: "read",
    async execute(_input, ctx) {
      const info = runtime.info();
      return result(ctx, {
        id: info.id,
        root: info.root,
        additionalRoots: info.additionalRoots,
        revision: info.revision,
        policyMode: info.policyMode,
        capabilities: info.capabilities,
        backendHealth: info.backendHealth,
      });
    },
  });

  map.set("fs_stat", {
    name: "fs_stat",
    risk: "read",
    async execute(input, ctx) {
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
      });
    },
  });

  map.set("fs_read", {
    name: "fs_read",
    risk: "read",
    async execute(input, ctx) {
      const { path: p } = input as { path: string };
      const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
      const raw = new Uint8Array(await fs.readFile(resolved.absolute));

      if (isLikelyBinary(raw)) throw err.binaryFile(`binary file: ${resolved.relPosix}`);

      const detected = detectEncoding(raw);
      let text: string;
      try {
        text = decodeText(raw, detected);
      } catch {
        throw err.unsupportedEncoding(`unsupported encoding: ${resolved.relPosix}`);
      }

      const fp = fingerprintBytes(raw);
      const snapshot = runtime.snapshots.record({
        path: resolved.relPosix,
        fingerprint: fp,
        encoding: detected.encoding,
        bom: detected.bom,
        newline: detectNewline(text),
        finalNewline: hasFinalNewline(text),
        workspaceRevision: ctx.workspace.revision,
      });
      runtime.snapshots.cacheContent(snapshot.id, raw);

      return result(ctx, {
        path: resolved.relPosix,
        snapshot_id: snapshot.id,
        content_hash: `sha256:${fp.digest}`,
        anchor: shortAnchor(fp.digest),
        encoding: detected.encoding,
        newline: detectNewline(text),
        finalNewline: hasFinalNewline(text),
        size: fp.size,
        content: text,
      });
    },
  });

  map.set("fs_write", {
    name: "fs_write",
    risk: "write",
    async execute(input, ctx) {
      const { path: p, content, expected_hash } = input as { path: string; content: string; expected_hash?: string };
      const resolved = await runtime.pathPolicy.resolveForWrite(ctx.workspace, p);
      await runtime.mutatePath(resolved.relPosix, async () => {
        let detected = detectEncoding(new Uint8Array());
        try {
          const existing = new Uint8Array(await fs.readFile(resolved.absolute));
          detected = detectEncoding(existing);
          if (expected_hash !== undefined && !digestMatches(expected_hash, fingerprintBytes(existing).digest)) {
            throw err.staleResource(`stale write for ${resolved.relPosix}`);
          }
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_STALE_RESOURCE") throw e;
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const newBytes = encodeText(content, detected.encoding);
        await atomicReplaceBytes(resolved.absolute, newBytes);
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
      }, { backend: "typescript" });
    },
  });

  map.set("fs_patch", {
    name: "fs_patch",
    risk: "write",
    async execute(input, ctx) {
      const { path: p, patch, expected_hash } = input as {
        path: string;
        patch: { hunks: Array<{ old: string; new: string }> };
        expected_hash?: string;
      };
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
        if (expected_hash !== undefined && !digestMatches(expected_hash, cur.digest)) {
          throw err.staleResource(`stale patch for ${resolved.relPosix}`);
        }
        const newText = applyHunks(text, parsed.hunks);
        const newBytes = encodeText(newText, detected.encoding);
        await atomicReplaceBytes(resolved.absolute, newBytes);
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
      }, { backend: "typescript" });
    },
  });

  map.set("search", {
    name: "search",
    risk: "read",
    async execute(input, ctx) {
      const { mode, pattern, path: scope } = input as { mode: "grep" | "glob"; pattern: string; path?: string };
      if (mode !== "grep" && mode !== "glob") throw err.invalidArgument("mode must be grep or glob");
      if (typeof pattern !== "string" || pattern === "") throw err.invalidArgument("pattern is required");
      const root = scope ? (await runtime.pathPolicy.resolveForRead(ctx.workspace, scope)).root : ctx.workspace.root;
      const backend = new NodeFallbackSearchBackend();
      const sensitive = new SensitivePathPolicy();
      const res = await backend.search({ mode, pattern, roots: [root] }, ctx.signal);
      const allowed = new Set(ctx.workspace.policy.allowedSensitivePaths.map((p) => p.replace(/\/+$/, "")));
      const filtered = res.matches.filter((m) => {
        if (sensitive.isSensitive(m.path) === undefined) return true;
        const p = m.path.replace(/\/+$/, "");
        return allowed.has(p) || [...allowed].some((a) => p.startsWith(a + "/"));
      });
      return result(ctx, {
        matches: filtered.slice(0, 20),
        truncated: filtered.length > 20,
        totalCount: res.totalCount,
      }, { backend: "node-fallback", degraded: true });
    },
  });

  map.set("ast_search", unsupported("ast_search"));
  map.set("lsp_status", unsupported("lsp_status"));
  map.set("lsp_diagnostics", unsupported("lsp_diagnostics"));
  map.set("lsp_symbols", unsupported("lsp_symbols"));
  map.set("lsp_navigate", unsupported("lsp_navigate"));
  const vcs = new GitVcsBackend();
  map.set("vcs_status", {
    name: "vcs_status",
    risk: "read",
    async execute(input, ctx) {
      const res = await vcs.status({}, ctx.signal);
      return result(ctx, res, { backend: "typescript" });
    },
  });
  map.set("vcs_diff", {
    name: "vcs_diff",
    risk: "read",
    async execute(input, ctx) {
      const res = await vcs.diff({}, ctx.signal);
      return result(ctx, res, { backend: "typescript" });
    },
  });

  return map;
}
