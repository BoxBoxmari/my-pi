import { registryKey, SUPPORTED_SERVERS } from "./registry-contract.js";
import { LspClient, type DiagnosticItem } from "./client.js";
import { detectLanguageFromPath, findWorkspaceRoot } from "./root-detection.js";

export interface ServerStatusInfo {
  key: string;
  workspaceId: string;
  language: string;
  state: string;
  running: boolean;
  pid?: number;
  restarts: number;
  diagnosticsCount: number;
}

export class LspRegistry {
  private readonly clients = new Map<string, LspClient>();
  private readonly starting = new Map<string, Promise<LspClient>>();

  async getClient(
    workspaceId: string,
    workspaceRoot: string,
    language: string,
    configHash = "default",
  ): Promise<LspClient> {
    const key = registryKey(workspaceId, language, configHash);
    const existing = this.clients.get(key);
    if (existing?.running) return existing;
    const pending = this.starting.get(key);
    if (pending) return pending;

    const start = (async () => {
      const current = this.clients.get(key);
      if (current?.running) return current;
      const root = findWorkspaceRoot(workspaceRoot, language, workspaceRoot);
      const client = new LspClient(root, language, configHash);
      this.clients.set(key, client);
      await client.start();
      return client;
    })();
    this.starting.set(key, start);
    try {
      return await start;
    } finally {
      if (this.starting.get(key) === start) this.starting.delete(key);
    }
  }

  async getClientForFile(
    workspaceId: string,
    workspaceRoot: string,
    filePath: string,
  ): Promise<LspClient | undefined> {
    const lang = detectLanguageFromPath(filePath);
    if (!lang || !SUPPORTED_SERVERS[lang]) return undefined;
    return this.getClient(workspaceId, workspaceRoot, lang);
  }

  getStatus(workspaceId?: string): ServerStatusInfo[] {
    const list: ServerStatusInfo[] = [];
    for (const [key, client] of this.clients.entries()) {
      if (workspaceId && !key.startsWith(`${workspaceId}:`)) continue;
      list.push({
        key,
        workspaceId: key.split(":")[0]!,
        language: client.language,
        state: client.state,
        running: client.running,
        pid: client.pid,
        restarts: client.restarts,
        diagnosticsCount: client.diagnostics.length,
      });
    }
    return list;
  }

  async shutdownAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.shutdownAndExit();
      } catch {
        client.forceKill();
      }
    }
    this.clients.clear();
  }
}

export const defaultLspRegistry = new LspRegistry();
