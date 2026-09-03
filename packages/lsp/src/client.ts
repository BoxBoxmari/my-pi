import { spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { err } from "@my-pi/contracts";
import { LSP_MAX_RESTARTS, LSP_IDLE_TIMEOUT_MS, type LspState } from "./lifecycle.js";
import { resolveServerCommand } from "./registry-contract.js";
import { LspFrameDecoder, LspFrameError } from "./frame-decoder.js";
import { sanitizedLspEnvironment, spawnSafeChild } from "./spawn-utils.js";

const LSP_REQUEST_TIMEOUT_MS = 25_000;

export interface DiagnosticItem {
  uri: string;
  file: string;
  message: string;
  line: number;
  column: number;
  severity: number;
  source?: string;
  code?: string | number;
}

export interface SymbolItem {
  name: string;
  kind: number;
  kindName?: string;
  containerName?: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  uri?: string;
}

export interface NavigationResult {
  action: "definition" | "references" | "hover";
  content?: string;
  locations?: Array<{
    uri: string;
    path: string;
    range: { start: { line: number; column: number }; end: { line: number; column: number } };
  }>;
}

interface PendingRequest {
  id: number;
  method: string;
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export function pathToUri(filePath: string): string {
  const norm = path.resolve(filePath).replace(/\\/g, "/");
  return norm.startsWith("/") ? `file://${norm}` : `file:///${norm}`;
}

export function uriToPath(uri: string): string {
  let p = uri.replace(/^file:\/\/\/?/, "");
  if (process.platform === "win32" && /^[a-zA-Z]:/.test(p)) {
    // Windows drive letter
  } else if (!p.startsWith("/")) {
    p = "/" + p;
  }
  return decodeURIComponent(p);
}

export class LspClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stateVal: LspState = "STOPPED";
  private restartCount = 0;
  private diagnosticsCache = new Map<string, DiagnosticItem[]>();
  private diagnosticsWaiters = new Map<string, Array<() => void>>();
  private diagnosticsPushed = new Set<string>();
  private openedDocuments = new Set<string>();
  private idleTimer: NodeJS.Timeout | null = null;
  private isKilled = false;
  private readonly frameDecoder = new LspFrameDecoder();

  constructor(
    readonly workspaceRoot: string,
    readonly language: string,
    readonly configHash = "default",
  ) {}

  get state(): LspState {
    return this.stateVal;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get restarts(): number {
    return this.restartCount;
  }

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.isKilled && !this.proc.killed;
  }

  get diagnostics(): DiagnosticItem[] {
    const list: DiagnosticItem[] = [];
    for (const items of this.diagnosticsCache.values()) {
      list.push(...items);
    }
    return list;
  }

  getDiagnosticsForFile(filePath: string): DiagnosticItem[] {
    const uri = pathToUri(filePath);
    return this.diagnosticsCache.get(uri) ?? [];
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.stateVal === "READY") {
        this.shutdownAndExit().catch(() => this.forceKill());
      }
    }, LSP_IDLE_TIMEOUT_MS);
  }

  async start(): Promise<void> {
    if (this.stateVal === "READY" && this.running) return;
    this.stateVal = "STARTING";
    this.isKilled = false;

    const resolved = resolveServerCommand(this.language, this.workspaceRoot);
    if (!resolved) {
      this.stateVal = "STOPPED";
      throw err.lspUnavailable(`No language server found for ${this.language}`);
    }

    try {
      this.proc = spawnSafeChild(resolved.command, resolved.args, {
        cwd: this.workspaceRoot,
        env: sanitizedLspEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e: any) {
      this.stateVal = "STOPPED";
      throw err.lspUnavailable(`Failed to spawn LSP server for ${this.language}: ${e.message}`);
    }

    if (!this.proc.pid) {
      this.stateVal = "STOPPED";
      throw err.lspUnavailable(`LSP server process failed to spawn for ${this.language}`);
    }

    this.proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.on("error", (e) => this.handleProcessExit(e));
    this.proc.on("close", () => this.handleProcessExit());

    try {
      await this.initializeServer();
      this.stateVal = "READY";
      this.resetIdleTimer();
    } catch (e: any) {
      this.stateVal = "DEGRADED";
      this.forceKill();
      throw e;
    }
  }

  private async initializeServer(): Promise<void> {
    const initParams = {
      processId: process.pid,
      rootUri: pathToUri(this.workspaceRoot),
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: true },
          hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        },
        workspace: {
          workspaceFolders: true,
          symbol: { dynamicRegistration: false },
        },
      },
      workspaceFolders: [
        {
          uri: pathToUri(this.workspaceRoot),
          name: path.basename(this.workspaceRoot),
        },
      ],
    };

    await this.request("initialize", initParams, 45_000);
    this.notify("initialized", {});
  }

  private handleProcessExit(e?: Error): void {
    const wasRunning = this.stateVal === "READY" || this.stateVal === "STARTING";
    this.rejectAll(e ?? new Error("LSP server process terminated"));

    if (this.stateVal === "STOPPING" || this.isKilled) {
      this.stateVal = "STOPPED";
      return;
    }

    if (wasRunning && this.restartCount < LSP_MAX_RESTARTS) {
      this.stateVal = "RESTARTING";
      this.restartCount++;
      const delay = 100 * Math.pow(2, this.restartCount - 1);
      setTimeout(() => {
        this.start().catch(() => {
          this.stateVal = "DEGRADED";
        });
      }, delay);
    } else {
      this.stateVal = this.restartCount >= LSP_MAX_RESTARTS ? "DEGRADED" : "STOPPED";
    }
  }

  private rejectAll(e: Error): void {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(e);
    }
    this.pending.clear();
  }

  private onData(chunk: Buffer): void {
    try {
      for (const body of this.frameDecoder.push(chunk)) {
        let msg: unknown;
        try {
          msg = JSON.parse(body.toString("utf8"));
        } catch (e) {
          throw new LspFrameError(`invalid LSP JSON body: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.handleMessage(msg);
      }
    } catch (e) {
      const failure = e instanceof Error ? e : new Error(String(e));
      this.rejectAll(failure);
      this.forceKill();
      this.stateVal = "DEGRADED";
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const req = this.pending.get(msg.id);
      if (req) {
        this.pending.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) {
          req.reject(new Error(msg.error.message ?? "LSP request error"));
        } else {
          req.resolve(msg.result);
        }
      }
    } else if (msg.method === "textDocument/publishDiagnostics") {
      this.handleDiagnostics(msg.params);
    }
  }

  /**
   * Wait (bounded) for the language server to publish diagnostics for the given
   * file after a didOpen. Without this, lsp_diagnostics reads an empty cache
   * before the async publishDiagnostics notification arrives.
   */
  async waitForDiagnostics(filePath: string, timeoutMs = 8_000): Promise<void> {
    const uri = pathToUri(filePath);
    if (this.diagnosticsPushed.has(uri)) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.diagnosticsWaiters.delete(uri);
        resolve();
      }, timeoutMs);
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const list = this.diagnosticsWaiters.get(uri) ?? [];
      list.push(waiter);
      this.diagnosticsWaiters.set(uri, list);
    });
  }

  private handleDiagnostics(params: any): void {
    if (!params?.uri) return;
    const uri = params.uri as string;
    if (!this.diagnosticsPushed.has(uri)) {
      this.diagnosticsPushed.add(uri);
      const waiters = this.diagnosticsWaiters.get(uri);
      if (waiters) {
        this.diagnosticsWaiters.delete(uri);
        for (const w of waiters) w();
      }
    }
    const filePath = uriToPath(uri);
    const rawList = (params.diagnostics ?? []) as Array<{
      message: string;
      range: { start: { line: number; character: number } };
      severity: number;
      source?: string;
      code?: string | number;
    }>;

    const items: DiagnosticItem[] = rawList.map((d) => ({
      uri,
      file: filePath,
      message: d.message,
      line: d.range?.start?.line ?? 0,
      column: d.range?.start?.character ?? 0,
      severity: d.severity ?? 1,
      source: d.source,
      code: d.code,
    }));

    this.diagnosticsCache.set(uri, items);
  }

  request<T = any>(method: string, params: unknown, timeoutMs = LSP_REQUEST_TIMEOUT_MS): Promise<T> {
    this.resetIdleTimer();
    const id = this.nextId++;
    const json = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify("$/cancelRequest", { id });
        reject(err.lspTimeout(`LSP request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { id, method, resolve, reject, timer });

      if (!this.proc?.stdin || !this.running) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err.lspUnavailable(`LSP server is not running`));
        return;
      }

      this.proc.stdin.write(frame);
    });
  }

  notify(method: string, params: unknown): void {
    this.resetIdleTimer();
    if (!this.proc?.stdin || !this.running) return;
    const json = JSON.stringify({ jsonrpc: "2.0", method, params });
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    this.proc.stdin.write(frame);
  }

  async openDocument(filePath: string, text?: string): Promise<void> {
    const uri = pathToUri(filePath);
    if (this.openedDocuments.has(uri)) return;

    let content = text;
    if (content === undefined) {
      try {
        content = await fs.promises.readFile(filePath, "utf8");
      } catch {
        content = "";
      }
    }

    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: this.language,
        version: 1,
        text: content,
      },
    });
    this.openedDocuments.add(uri);
  }

  async hover(filePath: string, line: number, column: number): Promise<string> {
    await this.openDocument(filePath);
    const uri = pathToUri(filePath);
    const res = await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character: column },
    });
    if (!res || !res.contents) return "";
    if (typeof res.contents === "string") return res.contents;
    if (Array.isArray(res.contents)) {
      return res.contents.map((c: any) => (typeof c === "string" ? c : c.value ?? "")).join("\n");
    }
    if (typeof res.contents === "object") {
      return res.contents.value ?? JSON.stringify(res.contents);
    }
    return JSON.stringify(res);
  }

  async definition(filePath: string, line: number, column: number): Promise<NavigationResult["locations"]> {
    await this.openDocument(filePath);
    const uri = pathToUri(filePath);
    const res = await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character: column },
    });
    if (!res) return [];
    const items = Array.isArray(res) ? res : [res];
    return items.map((loc: any) => ({
      uri: loc.uri ?? loc.targetUri,
      path: uriToPath(loc.uri ?? loc.targetUri),
      range: {
        start: { line: (loc.range ?? loc.targetRange)?.start?.line ?? 0, column: (loc.range ?? loc.targetRange)?.start?.character ?? 0 },
        end: { line: (loc.range ?? loc.targetRange)?.end?.line ?? 0, column: (loc.range ?? loc.targetRange)?.end?.character ?? 0 },
      },
    }));
  }

  async references(filePath: string, line: number, column: number): Promise<NavigationResult["locations"]> {
    await this.openDocument(filePath);
    const uri = pathToUri(filePath);
    const res = await this.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character: column },
      context: { includeDeclaration: true },
    });
    if (!res || !Array.isArray(res)) return [];
    return res.map((loc: any) => ({
      uri: loc.uri,
      path: uriToPath(loc.uri),
      range: {
        start: { line: loc.range?.start?.line ?? 0, column: loc.range?.start?.character ?? 0 },
        end: { line: loc.range?.end?.line ?? 0, column: loc.range?.end?.character ?? 0 },
      },
    }));
  }

  async documentSymbols(filePath: string): Promise<SymbolItem[]> {
    await this.openDocument(filePath);
    const uri = pathToUri(filePath);
    const res = await this.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    if (!res || !Array.isArray(res)) return [];
    return res.map((s: any) => ({
      name: s.name,
      kind: s.kind ?? 0,
      containerName: s.containerName,
      range: {
        start: { line: (s.range ?? s.location?.range)?.start?.line ?? 0, column: (s.range ?? s.location?.range)?.start?.character ?? 0 },
        end: { line: (s.range ?? s.location?.range)?.end?.line ?? 0, column: (s.range ?? s.location?.range)?.end?.character ?? 0 },
      },
      uri: s.location?.uri ?? uri,
    }));
  }

  async shutdownAndExit(): Promise<void> {
    this.stateVal = "STOPPING";
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      await this.request("shutdown", null, 3_000);
    } catch {
      // ignore
    } finally {
      this.notify("exit", null);
      this.stateVal = "STOPPED";
    }
  }

  forceKill(): void {
    this.isKilled = true;
    this.stateVal = "STOPPED";
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.proc) {
      if (process.platform === "win32" && this.proc.pid) {
        try {
          spawnSync("taskkill", ["/PID", String(this.proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } catch {
          // ignore
        }
      }
      try {
        this.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.proc = null;
    }
  }
}
