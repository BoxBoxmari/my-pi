import { readdir } from "node:fs/promises";
import path from "node:path";
import { CodeStateIndexer, CodeStateWatcher, type CodeGraphDelta, type CodeGraphSnapshot, type IndexContext } from "@my-pi/code-state";
import type { ProjectId } from "@my-pi/contracts";
import type { CoordinationStore } from "@my-pi/coordination-store";

const DEFAULT_MAX_WORKTREES = 64;
const DEFAULT_INITIAL_FILES = 200;
const DEFAULT_RECONCILE_FILES = 2_000;
const MAX_SCAN_DEPTH = 32;
const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist", "target", ".cache", "coverage", ".agent", ".agents", ".claude", ".codex", ".cursor", ".idea", ".knowns", ".opencode", ".vscode", ".x-harness"]);

export interface CodeStateManagerOptions {
  maxWorktrees?: number;
  initialFileLimit?: number;
  reconcileFileLimit?: number;
  reconcileMs?: number;
  onDelta?: (context: IndexContext, delta: CodeGraphDelta) => void | Promise<void>;
  onReady?: (context: IndexContext) => void | Promise<void>;
  onError?: (context: IndexContext, error: unknown) => void | Promise<void>;
}

export interface CodeStateManagerHealth {
  activeWorktrees: number;
  readyWorktrees: number;
  degradedWorktrees: number;
}

interface ManagedWorktree {
  context: IndexContext;
  indexer: CodeStateIndexer;
  watcher: CodeStateWatcher;
  knownPaths: Set<string>;
  state: "starting" | "ready" | "degraded";
  queue: Promise<void>;
}

export class CodeStateManager {
  private readonly worktrees = new Map<string, ManagedWorktree>();
  private readonly maxWorktrees: number;
  private readonly initialFileLimit: number;
  private readonly reconcileFileLimit: number;

  constructor(private readonly store: Pick<CoordinationStore, "applyCodeStateDelta" | "getCodeState">, private readonly options: CodeStateManagerOptions = {}) {
    this.maxWorktrees = boundedOption(options.maxWorktrees ?? DEFAULT_MAX_WORKTREES, 1, DEFAULT_MAX_WORKTREES, "maxWorktrees");
    this.initialFileLimit = boundedOption(options.initialFileLimit ?? DEFAULT_INITIAL_FILES, 1, DEFAULT_RECONCILE_FILES, "initialFileLimit");
    this.reconcileFileLimit = boundedOption(options.reconcileFileLimit ?? DEFAULT_RECONCILE_FILES, 1, DEFAULT_RECONCILE_FILES, "reconcileFileLimit");
  }

  async register(context: IndexContext): Promise<void> {
    const key = String(context.worktreeId);
    const existing = this.worktrees.get(key);
    if (existing) {
      if (path.resolve(existing.context.root) !== path.resolve(context.root) || existing.context.repositoryIdentity !== context.repositoryIdentity) throw new Error("worktree is already registered to a different canonical root");
      return;
    }
    if (this.worktrees.size >= this.maxWorktrees) throw new Error(`code-state worktree limit exceeded (${this.maxWorktrees})`);

    const indexer = new CodeStateIndexer(this.store);
    const snapshot = await indexer.load(context);
    const managed = {} as ManagedWorktree;
    managed.context = context;
    managed.indexer = indexer;
    managed.knownPaths = new Set(snapshot.entities.flatMap((entity) => entity.kind === "file" && entity.path ? [entity.path] : []));
    managed.state = "starting";
    managed.queue = Promise.resolve();
    managed.watcher = new CodeStateWatcher(context.root, {
      onPaths: (paths) => this.enqueue(managed, () => this.applyPaths(managed, paths)),
      onOverflow: () => this.enqueue(managed, () => this.reconcile(managed, this.reconcileFileLimit)),
      onError: (error) => this.markError(managed, error),
      reconcileMs: this.options.reconcileMs,
    });
    this.worktrees.set(key, managed);
    try {
      await this.enqueue(managed, () => this.reconcile(managed, this.initialFileLimit, false));
      if (!this.isDegraded(managed)) {
        managed.state = "ready";
        if (this.options.onReady) await this.options.onReady(context);
      }
    } catch (error) {
      managed.state = "degraded";
      this.notifyError(context, error);
    }
    managed.watcher.start();
    if (managed.watcher.status === "degraded") managed.state = "degraded";
  }

  async snapshot(projectId: ProjectId, worktreeId: string): Promise<CodeGraphSnapshot> {
    const managed = this.worktrees.get(String(worktreeId));
    if (managed) return managed.indexer.snapshot();
    return this.store.getCodeState(projectId, worktreeId);
  }

  health(): CodeStateManagerHealth {
    let readyWorktrees = 0;
    let degradedWorktrees = 0;
    for (const managed of this.worktrees.values()) {
      if (managed.state === "ready") readyWorktrees++;
      if (managed.state === "degraded") degradedWorktrees++;
    }
    return { activeWorktrees: this.worktrees.size, readyWorktrees, degradedWorktrees };
  }

  async stop(): Promise<void> {
    for (const managed of this.worktrees.values()) managed.watcher.stop();
    await Promise.allSettled([...this.worktrees.values()].map((managed) => managed.queue));
    this.worktrees.clear();
  }

  private enqueue(managed: ManagedWorktree, task: () => Promise<void>): Promise<void> {
    managed.queue = managed.queue.then(task, task).catch((error) => {
      managed.state = "degraded";
      this.notifyError(managed.context, error);
    });
    return managed.queue;
  }

  private async reconcile(managed: ManagedWorktree, limit: number, notify = true): Promise<void> {
    const paths = await discoverFiles(managed.context, limit);
    const current = new Set(paths);
    const removed = [...managed.knownPaths].filter((knownPath) => !current.has(knownPath));
    if (removed.length > 0) {
      const deltas = await managed.indexer.invalidate(managed.context, removed);
      if (notify) for (const delta of deltas) await this.emitDelta(managed.context, delta);
    }
    await this.applyPaths(managed, paths, notify);
    managed.knownPaths = current;
  }

  private async applyPaths(managed: ManagedWorktree, paths: string[], notify = true): Promise<void> {
    const unique = [...new Set(paths)].slice(0, this.reconcileFileLimit);
    for (const filePath of unique) {
      const resolved = await managed.context.resolveReadPath(filePath);
      if (!resolved.exists) {
        const deltas = await managed.indexer.invalidate(managed.context, [resolved.relPosix]);
        managed.knownPaths.delete(resolved.relPosix);
        if (notify) for (const delta of deltas) await this.emitDelta(managed.context, delta);
        continue;
      }
      const before = managed.indexer.snapshot();
      const delta = await managed.indexer.indexFile(managed.context, resolved.relPosix);
      managed.knownPaths.add(resolved.relPosix);
      const after = managed.indexer.snapshot();
      if (notify && fileStateChanged(before, after, resolved.relPosix)) await this.emitDelta(managed.context, delta);
    }
  }

  private async emitDelta(context: IndexContext, delta: CodeGraphDelta): Promise<void> {
    if (this.options.onDelta) await this.options.onDelta(context, delta);
  }

  private markError(managed: ManagedWorktree, error: unknown): void {
    managed.state = "degraded";
    this.notifyError(managed.context, error);
  }

  private isDegraded(managed: ManagedWorktree): boolean {
    return managed.state === "degraded";
  }

  private notifyError(context: IndexContext, error: unknown): void {
    if (this.options.onError) void Promise.resolve(this.options.onError(context, error)).catch(() => undefined);
  }
}

function fileStateChanged(before: CodeGraphSnapshot, after: CodeGraphSnapshot, relativePath: string): boolean {
  const previous = before.entities.find((entity) => entity.kind === "file" && entity.path === relativePath);
  const current = after.entities.find((entity) => entity.kind === "file" && entity.path === relativePath);
  if (!previous || !current) return previous !== current;
  const previousFingerprint = previous.fingerprint ? `${previous.fingerprint.algorithm}:${previous.fingerprint.digest}:${previous.fingerprint.size}` : "";
  const currentFingerprint = current.fingerprint ? `${current.fingerprint.algorithm}:${current.fingerprint.digest}:${current.fingerprint.size}` : "";
  return previousFingerprint !== currentFingerprint;
}

function boundedOption(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is out of bounds`);
  return value;
}

async function discoverFiles(context: IndexContext, limit: number): Promise<string[]> {
  const found: string[] = [];
  const pending: Array<{ relative: string; depth: number }> = [{ relative: "", depth: 0 }];
  while (pending.length > 0 && found.length < limit) {
    const current = pending.shift()!;
    const resolvedDirectory = await context.resolveReadPath(current.relative || context.root).catch(() => undefined);
    if (resolvedDirectory && !resolvedDirectory.exists) continue;
    let entries;
    try {
      entries = await readdir(path.join(context.root, current.relative), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (IGNORED_SEGMENTS.has(entry.name)) continue;
      const relative = current.relative ? path.join(current.relative, entry.name) : entry.name;
      const normalized = relative.replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        if (current.depth < MAX_SCAN_DEPTH) pending.push({ relative, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const resolved = await context.resolveReadPath(normalized).catch(() => undefined);
      if (resolved?.exists) found.push(resolved.relPosix);
    }
  }
  return found;
}
