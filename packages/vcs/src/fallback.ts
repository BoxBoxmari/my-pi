import { spawn } from "node:child_process";
import { err } from "@ccr/contracts";
import type { VcsBackend, VcsDiffRequest, VcsDiffResult, VcsStatusRequest, VcsStatusResult } from "@ccr/native-ports";

function runGit(root: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errOut = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (errOut += d.toString()));
    const onAbort = () => child.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => reject(err.nativeFailure(`git failed to start: ${e.message}`)));
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code === 0) resolve(out);
      else reject(err.nativeFailure(`git ${args[0]} exited ${code}: ${errOut.trim()}`));
    });
  });
}

export class GitVcsBackend implements VcsBackend {
  readonly kind = "node-fallback" as const;
  async status(request: VcsStatusRequest, signal: AbortSignal): Promise<VcsStatusResult> {
    const root = request.path ?? ".";
    let raw: string;
    try {
      raw = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], signal);
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_NATIVE_FAILURE") {
        return { clean: false, entries: [] };
      }
      throw e;
    }
    if (raw.trim() === "") return { clean: true, entries: [] };
    const entries = raw
      .split(/\r?\n/)
      .filter((l) => l.length > 3)
      .map((l) => ({ path: l.slice(3), status: l.slice(0, 2).trim() || "?" }));
    return { clean: false, entries };
  }
  async diff(request: VcsDiffRequest, signal: AbortSignal): Promise<VcsDiffResult> {
    const root = request.path ?? ".";
    let raw: string;
    try {
      raw = await runGit(root, ["diff", "--unified=3"], signal);
    } catch {
      return { summary: { additions: 0, deletions: 0, files: 0 }, hunks: [] };
    }
    const lines = raw.split(/\r?\n/);
    let additions = 0;
    let deletions = 0;
    for (const l of lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) additions++;
      else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
    }
    const files = lines.filter((l) => l.startsWith("diff --git ")).length;
    return { summary: { additions, deletions, files }, hunks: lines.slice(0, 500) };
  }
}
