/**
 * Read-only VCS backend via the git CLI (no shell interpolation; only
 * `status`/`diff` are ever invoked). Forbidden mutations are never executed.
 *
 * P0.1: Workspace authority is explicit — the caller must pass a resolved
 * absolute path. "." is never an implicit authority root. Failures are typed;
 * a failed Git command is NEVER converted into apparently-valid empty data.
 */
import { spawn } from "node:child_process";
import { err, type ArtifactRef } from "@my-pi/contracts";
import type { VcsBackend, VcsDiffRequest, VcsDiffResult, VcsStatusRequest, VcsStatusResult } from "@my-pi/native-ports";

const INLINE_HUNK_LINES = 500; // model-facing inline cap; remainder spills to artifact

type GitOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "non-git" }
  | { kind: "git-missing" }
  | { kind: "permission" }
  | { kind: "aborted" }
  | { kind: "failure"; code: number | undefined; stderr: string };

function classify(root: string, args: string[], signal: AbortSignal, e: unknown, stderr: string, code: number | undefined): GitOutcome {
  if (signal.aborted) return { kind: "aborted" };
  if (e !== null && typeof e === "object" && "code" in e && (e as { code?: string }).code === "ENOENT") {
    return { kind: "git-missing" };
  }
  // "not a git repository" — deterministic non-Git workspace signal
  if (/not a git repository/i.test(stderr) || /does not have any commits yet/i.test(stderr) === false && /fatal:/i.test(stderr) && /repository/i.test(stderr)) {
    return { kind: "non-git" };
  }
  if (code === 128 && /permission|denied/i.test(stderr)) return { kind: "permission" };
  return { kind: "failure", code, stderr };
}

function runGit(root: string, args: string[], signal: AbortSignal): Promise<GitOutcome> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ kind: "aborted" });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve(classify(root, args, signal, e, "", undefined));
      return;
    }
    let out = "";
    let errOut = "";
    let settled = false;
    const onAbort = () => {
      if (!settled) child.kill();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(classify(root, args, signal, e, errOut, undefined));
    });
    child.stdout?.on("data", (d) => {
      // Keep full stdout; large-diff spill is decided by the caller.
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      errOut += d.toString();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        resolve({ kind: "aborted" });
        return;
      }
      if (code === 0) resolve({ kind: "ok", stdout: out });
      else resolve(classify(root, args, signal, null, errOut, code === null ? undefined : code));
    });
  });
}

export interface VcsStatusOutcome {
  /** true when the workspace is not a Git repository at all. */
  isGitRepo: boolean;
  clean: boolean;
  entries: Array<{ path: string; status: string }>;
}

export class GitVcsBackend implements VcsBackend {
  readonly kind = "node-fallback" as const;

  /**
   * @param request.path REQUIRED absolute resolved path (workspace root or
   * an authorized scope inside it). Never ".".
   */
  async status(request: VcsStatusRequest, signal: AbortSignal): Promise<VcsStatusResult> {
    const root = request.path;
    if (root === undefined || root === "." || !path.isAbsoluteLike(root)) {
      throw err.invalidArgument("vcs_status requires a resolved absolute workspace path");
    }
    const res = await runGit(root, ["rev-parse", "--is-inside-work-tree"], signal);
    switch (res.kind) {
      case "aborted":
        throw err.aborted("vcs_status aborted");
      case "git-missing":
        throw err.nativeUnavailable("git executable not found");
      case "permission":
        throw err.permissionDenied("git permission failure");
      case "failure":
        throw err.nativeFailure(`git rev-parse failed (${res.code}): ${res.stderr.trim()}`);
      case "non-git":
        // Deterministic, typed non-Git signal — NOT fake valid data.
        throw err.unsupportedCapability("workspace is not a Git repository");
      case "ok": {
        if (res.stdout.trim() !== "true") {
          throw err.unsupportedCapability("workspace is not a Git repository (work tree)");
        }
        const st = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], signal);
        if (st.kind !== "ok") {
          switch (st.kind) {
            case "aborted":
              throw err.aborted("vcs_status aborted");
            case "git-missing":
              throw err.nativeUnavailable("git executable not found");
            case "permission":
              throw err.permissionDenied("git permission failure");
            default:
              throw err.nativeFailure(`git status failed (${(st as { code?: number }).code}): ${(st as { stderr: string }).stderr.trim()}`);
          }
        }
        if (st.stdout.trim() === "") return { clean: true, entries: [] };
        const entries = st.stdout
          .split(/\r?\n/)
          .filter((l) => l.length > 3)
          .map((l) => ({ path: l.slice(3), status: l.slice(0, 2).trim() || "?" }));
        return { clean: false, entries };
      }
    }
  }

  /**
   * @param request.path REQUIRED absolute resolved path.
   * @param opts.spillTo optional callback to spill overflow to an artifact store.
   * @param opts.inlineLimit optional inline hunks cap (default 500).
   */
  async diff(
    request: VcsDiffRequest,
    signal: AbortSignal,
    opts: { spillTo?: (data: string) => Promise<ArtifactRef>; inlineLimit?: number } = {},
  ): Promise<VcsDiffResult> {
    const root = request.path;
    const inlineLimit = opts.inlineLimit ?? INLINE_HUNK_LINES;
    if (root === undefined || root === "." || !path.isAbsoluteLike(root)) {
      throw err.invalidArgument("vcs_diff requires a resolved absolute workspace path");
    }
    const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"], signal);
    switch (inside.kind) {
      case "aborted":
        throw err.aborted("vcs_diff aborted");
      case "git-missing":
        throw err.nativeUnavailable("git executable not found");
      case "permission":
        throw err.permissionDenied("git permission failure");
      case "non-git":
        throw err.unsupportedCapability("workspace is not a Git repository");
      case "failure":
        throw err.nativeFailure(`git rev-parse failed (${inside.code}): ${inside.stderr.trim()}`);
      case "ok":
        break;
    }
    const res = await runGit(root, ["diff", "--unified=3"], signal);
    switch (res.kind) {
      case "aborted":
        throw err.aborted("vcs_diff aborted");
      case "git-missing":
        throw err.nativeUnavailable("git executable not found");
      case "permission":
        throw err.permissionDenied("git permission failure");
      case "non-git":
        throw err.unsupportedCapability("workspace is not a Git repository");
      case "failure":
        throw err.nativeFailure(`git diff failed (${res.code}): ${res.stderr.trim()}`);
      case "ok": {
        const raw = res.stdout;
        const lines = raw.split(/\r?\n/);
        let additions = 0;
        let deletions = 0;
        for (const l of lines) {
          if (l.startsWith("+") && !l.startsWith("+++")) additions++;
          else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
        }
        const files = lines.filter((l) => l.startsWith("diff --git ")).length;
        const truncated = lines.length > inlineLimit;
        const inline = lines.slice(0, inlineLimit);
        // G2/VCS hardening: overflow spills to an artifact instead of being dropped.
        let artifact: ArtifactRef | undefined;
        if (truncated && opts.spillTo) {
          artifact = await opts.spillTo(raw);
        }
        const out: VcsDiffResult = {
          summary: { additions, deletions, files },
          hunks: inline,
          truncated,
        };
        if (artifact) out.diffArtifact = artifact;
        return out;
      }
    }
  }
}

// Local path helper: absolute-path check without importing node:path twice.
const path = {
  isAbsoluteLike(p: string): boolean {
    return p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(p);
  },
};
