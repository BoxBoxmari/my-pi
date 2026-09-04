import { watch as fsWatch, type FSWatcher, type WatchOptions } from "node:fs";
import path from "node:path";

export type WatchFactory = (target: string, options: WatchOptions | undefined, listener: (eventType: string, filename: string | Buffer | null) => void) => FSWatcher;

export interface CodeStateWatcherOptions {
  debounceMs?: number;
  maxPendingPaths?: number;
  reconcileMs?: number;
  ignoredSegments?: string[];
  onPaths: (paths: string[]) => void | Promise<void>;
  onOverflow?: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
  watchFactory?: WatchFactory;
}

const DEFAULT_IGNORED_SEGMENTS = [".git", "node_modules", "dist", "target", ".cache"];
const DEFAULT_RECONCILE_MS = 5_000;

/** File events are optimization hints; index fingerprints remain authoritative. */
export class CodeStateWatcher {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;
  private readonly pending = new Set<string>();
  private overflowed = false;
  private state: "stopped" | "ready" | "degraded" = "stopped";

  constructor(private readonly root: string, private readonly options: CodeStateWatcherOptions) {}

  get status(): "stopped" | "ready" | "degraded" {
    return this.state;
  }

  start(): void {
    if (this.state !== "stopped") return;
    const onEvent = (_event: string, filename: string | Buffer | null) => {
      if (!filename) return;
      const relative = String(filename).replaceAll("\\", "/");
      const segments = relative.split("/");
      const ignored = this.options.ignoredSegments ?? DEFAULT_IGNORED_SEGMENTS;
      if (segments.some((segment) => ignored.includes(segment))) return;
      const maxPending = this.options.maxPendingPaths ?? 2_000;
      if (this.pending.size >= maxPending && !this.pending.has(relative)) {
        this.overflowed = true;
      } else {
        this.pending.add(relative);
      }
      this.scheduleFlush();
    };
    const factory = this.options.watchFactory ?? ((target, watchOptions, listener) => watchOptions === undefined ? fsWatch(target, listener) : fsWatch(target, watchOptions, listener));
    const attach = (watcher: FSWatcher): void => {
      watcher.on("error", (error) => this.handleError(error));
      this.watcher = watcher;
    };
    this.state = "degraded";
    try {
      attach(factory(this.root, { recursive: true }, onEvent));
      this.state = "ready";
      return;
    } catch (recursiveError) {
      this.notifyError(recursiveError);
    }
    try {
      // A non-recursive watcher is only an invalidation hint. Reconciliation
      // remains active so nested changes are eventually discovered.
      attach(factory(this.root, undefined, onEvent));
      this.startReconciliation();
    } catch (fallbackError) {
      this.notifyError(fallbackError);
      this.startReconciliation();
    }
  }

  stop(): void {
    try {
      this.watcher?.close();
    } catch {
      // Closing an already-failed platform watcher is best effort.
    }
    this.watcher = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    this.pending.clear();
    this.overflowed = false;
    this.state = "stopped";
  }

  private handleError(error: unknown): void {
    try {
      this.watcher?.close();
    } catch {
      // Closing an already-failed platform watcher is best effort.
    }
    this.watcher = undefined;
    this.state = "degraded";
    this.notifyError(error);
    this.startReconciliation();
    this.overflowed = true;
    this.scheduleFlush();
  }

  private startReconciliation(): void {
    const interval = this.options.reconcileMs ?? DEFAULT_RECONCILE_MS;
    if (!Number.isFinite(interval) || interval <= 0 || this.reconciliationTimer) return;
    this.reconciliationTimer = setInterval(() => {
      if (this.state === "stopped") return;
      this.overflowed = true;
      this.scheduleFlush();
    }, interval);
    this.reconciliationTimer.unref();
  }

  private notifyError(error: unknown): void {
    if (this.options.onError) void Promise.resolve(this.options.onError(error)).catch(() => undefined);
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const paths = [...this.pending];
      const overflowed = this.overflowed;
      this.pending.clear();
      this.overflowed = false;
      if (overflowed && this.options.onOverflow) void Promise.resolve(this.options.onOverflow()).catch((error) => this.notifyError(error));
      if (paths.length > 0) void Promise.resolve(this.options.onPaths(paths)).catch((error) => this.notifyError(error));
    }, this.options.debounceMs ?? 100);
    this.timer.unref();
  }
}

export function watcherPath(root: string, filename: string): string {
  return path.relative(root, path.resolve(root, filename)).replaceAll("\\", "/");
}
