import type { ArtifactRef, CapabilityResult, SnapshotId } from "@ccr/contracts";

export interface SearchRequest {
  mode: "grep" | "glob";
  pattern: string;
  roots?: string[];
  include?: string[];
  exclude?: string[];
  ignoreGitignore?: boolean;
  caseSensitive?: boolean;
  contextBefore?: number;
  contextAfter?: number;
  limit?: number;
  /**
   * P0.2: policy gate invoked during traversal, BEFORE any file is opened.
   * Receives the POSIX-relative path of the candidate file/dir; return false
   * to skip it (and skip descending into denied directories where possible).
   * This is the enforcement boundary — output filtering alone is forbidden.
   */
  allowed?: (relPosixPath: string, isDirectory: boolean) => boolean;
  /**
   * Test instrumentation hook: invoked immediately before a file is opened
   * for reading. Used by regression tests to PROVE denied sensitive files
   * cause zero protected read operations. Not used for production logic.
   */
  onFileRead?: (relPosixPath: string) => void;
}

export interface SearchMatch {
  path: string;
  line?: number;
  column?: number;
  text: string;
  before?: string[];
  after?: string[];
  snapshotId?: SnapshotId;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  totalCount: number;
}

export interface SearchBackend {
  readonly kind: "native" | "node-fallback";
  search(request: SearchRequest, signal: AbortSignal): Promise<SearchResult>;
}

export interface AstSearchRequest {
  pattern: string;
  paths: string[];
  limit?: number;
}

export interface AstSearchResult {
  matches: Array<{
    path: string;
    range: { start: { line: number; column: number }; end: { line: number; column: number } };
    captures: Record<string, string>;
    text: string;
  }>;
  truncated: boolean;
  totalCount: number;
}

export interface AstBackend {
  readonly kind: "native" | "node-fallback";
  search(request: AstSearchRequest, signal: AbortSignal): Promise<AstSearchResult>;
}

export interface VcsStatusRequest {
  path?: string;
}

export interface VcsStatusResult {
  clean: boolean;
  entries: Array<{ path: string; status: string }>;
}

export interface VcsDiffRequest {
  path?: string;
}

export interface VcsDiffResult {
  summary: { additions: number; deletions: number; files: number };
  hunks: string[];
  truncated?: boolean;
  diffArtifact?: ArtifactRef;
}

export interface VcsBackend {
  readonly kind: "native" | "node-fallback";
  status(request: VcsStatusRequest, signal: AbortSignal): Promise<VcsStatusResult>;
  diff(request: VcsDiffRequest, signal: AbortSignal): Promise<VcsDiffResult>;
}

export type BackendExecution<T> = Promise<{
  data: T;
  backend: CapabilityResult<T>["backend"];
  degraded: boolean;
  nativeMs?: number;
  ioMs?: number;
}>;
