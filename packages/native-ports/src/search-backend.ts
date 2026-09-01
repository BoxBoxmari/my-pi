import type { CapabilityResult, SnapshotId } from "@ccr/contracts";

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
