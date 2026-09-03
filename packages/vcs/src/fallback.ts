/**
 * Read-only VCS backend via the git CLI.
 *
 * Git output is streamed so a large diff never has to exist as one in-memory
 * string. The caller may also provide a path policy; filtered paths are never
 * passed to the content-producing diff command.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { err, type ArtifactRef } from "@my-pi/contracts";
import type { ArtifactWriter } from "@my-pi/artifact-store";
import type { VcsBackend, VcsDiffRequest, VcsDiffResult, VcsStatusRequest, VcsStatusResult } from "@my-pi/native-ports";

const INLINE_HUNK_LINES = 500;
const INLINE_HUNK_BYTES = 256 * 1024;
const MAX_GIT_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_GIT_DIFF_BYTES = 64 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 64 * 1024;

type GitOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "non-git" }
  | { kind: "git-missing" }
  | { kind: "permission" }
  | { kind: "aborted" }
  | { kind: "output-limit" }
  | { kind: "failure"; code: number | undefined; stderr: string };

export interface VcsDiffOptions {
  beginSpill?: (mimeType: string) => Promise<ArtifactWriter>;
  inlineLimit?: number;
  inlineBytesLimit?: number;
  maxOutputBytes?: number;
  allowedPath?: (relativePath: string, root: string) => boolean;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_DIFF_OPTS;
  env.GIT_PAGER = "cat";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function classify(stderr: string, code: number | undefined, signal: AbortSignal, error?: unknown): GitOutcome {
  if (signal.aborted) return { kind: "aborted" };
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return { kind: "git-missing" };
  }
  if (/not a git repository/i.test(stderr) || (/fatal:/i.test(stderr) && /repository/i.test(stderr) && !/does not have any commits yet/i.test(stderr))) {
    return { kind: "non-git" };
  }
  if (code === 128 && /permission|denied/i.test(stderr)) return { kind: "permission" };
  return { kind: "failure", code, stderr };
}

function appendBounded(current: string, chunk: Buffer, maxBytes: number): { value: string; exceeded: boolean } {
  const remaining = maxBytes - Buffer.byteLength(current);
  if (remaining <= 0) return { value: current, exceeded: true };
  if (chunk.byteLength <= remaining) return { value: current + chunk.toString(), exceeded: false };
  return { value: current + chunk.subarray(0, remaining).toString(), exceeded: true };
}

function runGit(root: string, args: string[], signal: AbortSignal, maxOutputBytes = MAX_GIT_METADATA_BYTES): Promise<GitOutcome> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ kind: "aborted" });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn("git", args, {
        cwd: root,
        env: gitEnvironment(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(classify("", undefined, signal, error));
      return;
    }

    let out = "";
    let errOut = "";
    let outputExceeded = false;
    let settled = false;
    const onAbort = () => {
      if (!settled) child.kill();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(classify(errOut, undefined, signal, error));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (outputExceeded) return;
      const bounded = appendBounded(out, chunk, maxOutputBytes);
      out = bounded.value;
      outputExceeded = bounded.exceeded;
      if (outputExceeded) child.kill();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errOut = appendBounded(errOut, chunk, MAX_GIT_STDERR_BYTES).value;
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        resolve({ kind: "aborted" });
      } else if (outputExceeded) {
        resolve({ kind: "output-limit" });
      } else if (code === 0) {
        resolve({ kind: "ok", stdout: out });
      } else {
        resolve(classify(errOut, code === null ? undefined : code, signal));
      }
    });
  });
}

async function runGitStream(
  root: string,
  args: string[],
  signal: AbortSignal,
  onChunk: (chunk: Buffer) => Promise<void>,
): Promise<GitOutcome> {
  if (signal.aborted) return { kind: "aborted" };
  let child: ChildProcess;
  try {
    child = spawn("git", args, {
      cwd: root,
      env: gitEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return classify("", undefined, signal, error);
  }

  let errOut = "";
  let processError: unknown;
  let finished = false;
  let closeResolve!: (code: number | null | undefined) => void;
  const closePromise = new Promise<number | null | undefined>((resolve) => {
    closeResolve = resolve;
  });
  const onAbort = () => {
    if (!finished) child.kill();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  child.on("error", (error) => {
    processError = error;
    if (!finished) {
      finished = true;
      closeResolve(undefined);
    }
  });
  child.on("close", (code) => {
    if (!finished) {
      finished = true;
      closeResolve(code);
    }
  });

  const stderrTask = (async () => {
    if (!child.stderr) return;
    for await (const chunk of child.stderr) {
      errOut = appendBounded(errOut, Buffer.from(chunk), MAX_GIT_STDERR_BYTES).value;
    }
  })();

  let chunkError: unknown;
  try {
    if (child.stdout) {
      for await (const chunk of child.stdout) {
        if (signal.aborted) break;
        await onChunk(Buffer.from(chunk));
      }
    }
  } catch (error) {
    chunkError = error;
    child.kill();
  }

  const code = await closePromise;
  await stderrTask;
  signal.removeEventListener("abort", onAbort);
  if (chunkError) throw chunkError;
  if (signal.aborted) return { kind: "aborted" };
  if (processError) return classify(errOut, undefined, signal, processError);
  if (code === 0) return { kind: "ok", stdout: "" };
  return classify(errOut, code === null ? undefined : code, signal);
}

function parseNulPaths(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

function parsePorcelainStatus(stdout: string): Array<{ path: string; status: string }> {
  const fields = stdout.split("\0").filter((entry) => entry.length > 0);
  const entries: Array<{ path: string; status: string }> = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i]!;
    const status = record.slice(0, 2).trim() || "?";
    const oldPath = record.slice(3);
    if ((status === "R" || status === "C") && fields[i + 1] !== undefined) {
      entries.push({ path: `${oldPath} -> ${fields[++i]}`, status });
    } else {
      entries.push({ path: oldPath, status });
    }
  }
  return entries;
}

class DiffCollector {
  private readonly decoder = new StringDecoder("utf8");
  private readonly rawPrefix: Buffer[] = [];
  private rawPrefixBytes = 0;
  private textBuffer = "";
  private writer?: ArtifactWriter;
  private inlineBytes = 0;
  private lineCount = 0;
  private outputBytes = 0;
  private additions = 0;
  private deletions = 0;
  private readonly inline: string[] = [];
  private truncatedValue = false;

  constructor(private readonly opts: VcsDiffOptions) {}

  get truncated(): boolean {
    return this.truncatedValue;
  }

  get lines(): string[] {
    return this.inline;
  }

  get summary(): { additions: number; deletions: number } {
    return { additions: this.additions, deletions: this.deletions };
  }

  async append(chunk: Buffer): Promise<void> {
    this.outputBytes += chunk.byteLength;
    if (this.outputBytes > (this.opts.maxOutputBytes ?? MAX_GIT_DIFF_BYTES)) {
      throw err.outputLimit(`Git diff exceeds ${this.opts.maxOutputBytes ?? MAX_GIT_DIFF_BYTES} bytes`);
    }

    if (this.writer) {
      await this.writer.append(chunk);
    } else if (this.opts.beginSpill) {
      if (this.rawPrefixBytes + chunk.byteLength <= (this.opts.inlineBytesLimit ?? INLINE_HUNK_BYTES)) {
        this.rawPrefix.push(Buffer.from(chunk));
        this.rawPrefixBytes += chunk.byteLength;
      } else {
        this.truncatedValue = true;
        const writer = await this.startWriter();
        if (!writer) throw new Error("artifact writer was not created");
        await writer.append(chunk);
      }
    }

    await this.consumeText(this.decoder.write(chunk));
    if (!this.writer && this.truncatedValue && this.opts.beginSpill) await this.startWriter();
  }

  private async startWriter(): Promise<ArtifactWriter | undefined> {
    if (this.writer) return this.writer;
    if (!this.opts.beginSpill) return undefined;
    const writer = await this.opts.beginSpill("text/plain");
    this.writer = writer;
    if (this.rawPrefix.length > 0) {
      await writer.append(Buffer.concat(this.rawPrefix));
      this.rawPrefix.length = 0;
      this.rawPrefixBytes = 0;
    }
    return writer;
  }

  private async consumeText(text: string): Promise<void> {
    this.textBuffer += text;
    for (;;) {
      const newline = this.textBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.textBuffer.slice(0, newline).replace(/\r$/, "");
      this.textBuffer = this.textBuffer.slice(newline + 1);
      await this.consumeLine(line);
    }
  }

  private async consumeLine(line: string): Promise<void> {
    this.lineCount++;
    if (line.startsWith("+") && !line.startsWith("+++")) this.additions++;
    if (line.startsWith("-") && !line.startsWith("---")) this.deletions++;

    const lineBytes = Buffer.byteLength(line) + 1;
    if (this.lineCount > (this.opts.inlineLimit ?? INLINE_HUNK_LINES) || this.inlineBytes + lineBytes > (this.opts.inlineBytesLimit ?? INLINE_HUNK_BYTES)) {
      this.truncatedValue = true;
      return;
    }
    this.inline.push(line);
    this.inlineBytes += lineBytes;
  }

  async finish(): Promise<{ artifact?: ArtifactRef }> {
    await this.consumeText(this.decoder.end());
    if (this.textBuffer.length > 0) {
      await this.consumeLine(this.textBuffer);
      this.textBuffer = "";
    }
    if (this.truncatedValue && this.opts.beginSpill) await this.startWriter();
    if (this.writer) return { artifact: await this.writer.finish() };
    return {};
  }

  async abort(): Promise<void> {
    await this.writer?.abort();
    this.rawPrefix.length = 0;
  }
}

function outcomeError(operation: string, outcome: GitOutcome): never {
  switch (outcome.kind) {
    case "aborted":
      throw err.aborted(`${operation} aborted`);
    case "git-missing":
      throw err.nativeUnavailable("git executable not found");
    case "permission":
      throw err.permissionDenied("git permission failure");
    case "non-git":
      throw err.unsupportedCapability("workspace is not a Git repository");
    case "output-limit":
      throw err.outputLimit(`${operation} output exceeded the maximum size`);
    case "failure":
      throw err.nativeFailure(`${operation} failed (${outcome.code}): ${outcome.stderr.trim()}`);
    case "ok":
      throw new Error(`${operation} unexpectedly succeeded in error path`);
  }
}

export interface VcsStatusOutcome {
  isGitRepo: boolean;
  clean: boolean;
  entries: Array<{ path: string; status: string }>;
}

export class GitVcsBackend implements VcsBackend {
  readonly kind = "node-fallback" as const;

  async status(request: VcsStatusRequest, signal: AbortSignal): Promise<VcsStatusResult> {
    const root = request.path;
    if (root === undefined || root === "." || !isAbsoluteLike(root)) {
      throw err.invalidArgument("vcs_status requires a resolved absolute workspace path");
    }
    const res = await runGit(root, ["rev-parse", "--is-inside-work-tree"], signal);
    if (res.kind !== "ok") outcomeError("git rev-parse", res);
    if (res.stdout.trim() !== "true") throw err.unsupportedCapability("workspace is not a Git repository (work tree)");

    const st = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], signal);
    if (st.kind !== "ok") outcomeError("git status", st);
    if (st.stdout.trim() === "") return { clean: true, entries: [] };
    const entries = parsePorcelainStatus(st.stdout);
    return { clean: false, entries };
  }

  async diff(request: VcsDiffRequest, signal: AbortSignal, opts: VcsDiffOptions = {}): Promise<VcsDiffResult> {
    const root = request.path;
    const inlineLimit = opts.inlineLimit ?? INLINE_HUNK_LINES;
    if (root === undefined || root === "." || !isAbsoluteLike(root)) {
      throw err.invalidArgument("vcs_diff requires a resolved absolute workspace path");
    }

    const names = await runGit(root, ["-c", "core.quotePath=false", "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--", "."], signal);
    if (names.kind !== "ok") outcomeError("git diff --name-only", names);
    const changedPaths = parseNulPaths(names.stdout);
    const selectedPaths = changedPaths.filter((path) => opts.allowedPath?.(path, root) ?? true);
    if (selectedPaths.length === 0) return { summary: { additions: 0, deletions: 0, files: 0 }, hunks: [], truncated: false };

    const pathspecs = selectedPaths.map((path) => `:(literal)${path}`);
    const collector = new DiffCollector({ ...opts, inlineLimit });
    try {
      const diff = await runGitStream(
        root,
        ["-c", "core.quotePath=false", "diff", "--unified=3", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color", "--", ...pathspecs],
        signal,
        (chunk) => collector.append(chunk),
      );
      if (diff.kind !== "ok") outcomeError("git diff", diff);
      const spill = await collector.finish();
      return {
        summary: { ...collector.summary, files: selectedPaths.length },
        hunks: collector.lines,
        truncated: collector.truncated,
        ...(spill.artifact ? { diffArtifact: spill.artifact } : {}),
      };
    } catch (error) {
      await collector.abort();
      throw error;
    }
  }
}

function isAbsoluteLike(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(p);
}
