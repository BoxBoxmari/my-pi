import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

export interface CodeStateWatcherOptions {
  debounceMs?: number;
  maxPendingPaths?: number;
  ignoredSegments?: string[];
  onPaths: (paths: string[]) => void | Promise<void>;
  onOverflow?: () => void | Promise<void>;
}

const DEFAULT_IGNORED_SEGMENTS = [".git", "node_modules", "dist", "target", ".cache"];

/** File events are optimization hints; index fingerprints remain authoritative. */
export class CodeStateWatcher {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private readonly pending = new Set<string>();
  private overflowed = false;

  constructor(private readonly root: string, private readonly options: CodeStateWatcherOptions) {}

  start(): void {
    if (this.watcher) return;
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
    try {
      this.watcher = watch(this.root, { recursive: true }, onEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") throw error;
      // Linux does not provide recursive fs.watch; retain a bounded root hint
      // and let callers schedule explicit scans for nested directories.
      this.watcher = watch(this.root, onEvent);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.overflowed = false;
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const paths = [...this.pending];
      const overflowed = this.overflowed;
      this.pending.clear();
      this.overflowed = false;
      if (overflowed && this.options.onOverflow) void this.options.onOverflow();
      if (paths.length > 0) void this.options.onPaths(paths);
    }, this.options.debounceMs ?? 100);
    this.timer.unref();
  }
}

export function watcherPath(root: string, filename: string): string {
  return path.relative(root, path.resolve(root, filename)).replaceAll("\\", "/");
}
