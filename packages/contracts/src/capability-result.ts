/** Stable capability result / error / context contracts. */
import type { RequestId, WorkspaceId } from "./ids.js";
import type { Diagnostic } from "./diagnostics.js";
import type { ArtifactRef } from "./artifact.js";
import type { Workspace } from "./workspace.js";
import type { CapabilityClass } from "./workspace.js";

export type BackendKind = "native" | "node-fallback" | "typescript" | "lsp";

export interface CapabilityResult<T> {
  schemaVersion: "1";
  requestId: string;
  workspaceId: string;
  revision: number;
  data: T;
  warnings?: Diagnostic[];
  diagnostics?: Diagnostic[];
  artifacts?: ArtifactRef[];
  backend?: BackendKind;
  degraded?: boolean;
  timing: {
    totalMs: number;
    nativeMs?: number;
    ioMs?: number;
  };
}

export interface CapabilityContext {
  requestId: RequestId;
  workspace: Workspace;
  signal: AbortSignal;
  deadline?: number;
  trace?: Record<string, string | number | boolean | undefined>;
}

export interface Capability<I, O> {
  name: string;
  risk: CapabilityClass;
  execute(input: I, ctx: CapabilityContext): Promise<CapabilityResult<O>>;
}
