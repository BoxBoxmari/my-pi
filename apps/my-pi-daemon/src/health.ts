import type { IpcEndpoint } from "@my-pi/coordination-client";
import type { DaemonState } from "./lifecycle.js";

export interface DaemonHealth {
  schemaVersion: "1";
  protocolVersion: string;
  storeSchemaVersion: number;
  state: DaemonState;
  projectId: string;
  projectKey: string;
  projectRoot: string;
  projectCanonicalIdentity: string;
  endpoint: IpcEndpoint;
  pid: number;
  startedAt: string;
  rssBytes: number;
  store: "ready" | "degraded" | "closed";
  codeState: {
    activeWorktrees: number;
    readyWorktrees: number;
    degradedWorktrees: number;
  };
}
