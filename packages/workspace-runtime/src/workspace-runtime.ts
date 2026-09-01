import path from "node:path";
import { promises as fs } from "node:fs";
import {
  DEFAULT_WORKSPACE_POLICY,
  err,
  createWorkspaceId,
  type Workspace,
  type WorkspaceCapabilities,
  type WorkspaceId,
  type WorkspacePolicy,
} from "@ccr/contracts";
import { PathPolicy } from "./path-policy.js";
import { SnapshotStore } from "./snapshot-store.js";
import { withWorkspaceLock } from "./mutation-mutex.js";

export interface OpenWorkspaceOptions {
  root: string;
  additionalRoots?: string[];
  policy?: Partial<WorkspacePolicy>;
  capabilities?: Partial<WorkspaceCapabilities>;
}

export interface WorkspaceInfo {
  id: WorkspaceId;
  root: string;
  additionalRoots: string[];
  revision: number;
  policyMode: WorkspacePolicy["mode"];
  /** R0.1.9: CATALOG capabilities (advertised tool surface, stable). */
  catalogCapabilities: WorkspaceCapabilities;
  /** R0.1.9: OPERATIONAL capabilities (healthy providers, may lag catalog). */
  operationalCapabilities: WorkspaceCapabilities;
  backendHealth: {
    native: boolean;
    nodeFallback: boolean;
  };
}

/** R0.1.9: the full V1 catalog (all 13 advertised tools). */
export const CATALOG_CAPABILITIES: WorkspaceCapabilities = {
  read: true,
  write: true,
  search: true,
  ast: true,
  lsp: true,
  vcs: true,
};

/** R0.1.9: what is ACTUALLY operational today (8 tools). AST/LSP are false
 * until their gates (G4/G5) pass and a healthy provider is registered. */
export const OPERATIONAL_CAPABILITIES: WorkspaceCapabilities = {
  read: true,
  write: true,
  search: true,
  ast: false,
  lsp: false,
  vcs: true,
};

export class WorkspaceRuntime {
  private workspace?: Workspace;
  readonly pathPolicy = new PathPolicy();
  readonly snapshots = new SnapshotStore();

  async open(opts: OpenWorkspaceOptions): Promise<Workspace> {
    if (this.workspace) throw err.invalidArgument("a workspace is already open");
    const real = await fs.realpath(opts.root);
    const policy: WorkspacePolicy = {
      ...DEFAULT_WORKSPACE_POLICY,
      ...opts.policy,
    };
    const capabilities: WorkspaceCapabilities = {
      ...OPERATIONAL_CAPABILITIES,
      ...opts.capabilities,
    };
    const additionalRoots = (opts.additionalRoots ?? []).map((r) => path.resolve(r));
    this.workspace = {
      id: createWorkspaceId(),
      root: real,
      additionalRoots,
      revision: 0,
      policy,
      capabilities,
    };
    return this.workspace;
  }

  get workspaceOrThrow(): Workspace {
    if (!this.workspace) throw err.workspaceNotFound();
    return this.workspace;
  }

  get current(): Workspace | undefined {
    return this.workspace;
  }

  info(): WorkspaceInfo {
    const ws = this.workspaceOrThrow;
    return {
      id: ws.id,
      root: ws.root,
      additionalRoots: ws.additionalRoots,
      revision: ws.revision,
      policyMode: ws.policy.mode,
      // R0.1.9: catalog = full advertised surface; operational = healthy
      // providers actually available right now.
      catalogCapabilities: CATALOG_CAPABILITIES,
      operationalCapabilities: ws.capabilities,
      backendHealth: {
        // P1.3: truthful operational health. No native addon exists yet
        // (napi-rs not activated), and the Node fallback IS active.
        native: false,
        nodeFallback: true,
      },
    };
  }

  async mutatePath(relPosix: string, fn: () => Promise<void>): Promise<void> {
    const ws = this.workspaceOrThrow;
    await withWorkspaceLock(ws.id, async () => {
      await fn();
      ws.revision++;
      this.snapshots.invalidate(relPosix);
    });
  }
}
