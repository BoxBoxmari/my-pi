import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  validateGraphSnapshot,
  createTheaterFrame,
  type GraphKind,
  type GraphSnapshot,
  type GraphTrace,
  type TheaterEvent,
} from "@my-pi/graph-model";
import type { GraphEventsResponse } from "@my-pi/coordination-client";
import { renderGraphViewHtml, renderTheaterViewHtml } from "./view.js";

export interface PortalGraphReader {
  graphSnapshot(input: { projectId: string; kind: GraphKind; worktreeId?: string; subjectId?: string; maxNodes?: number; maxEdges?: number; maxAttributeBytes?: number }): Promise<GraphSnapshot>;
  graphExpand?(input: { projectId: string; kind: GraphKind; nodeId: string; depth?: number; worktreeId?: string; subjectId?: string; maxNodes?: number; maxEdges?: number; maxAttributeBytes?: number }): Promise<GraphSnapshot>;
  graphTrace?(input: { projectId: string; kind: GraphKind; fromNodeId: string; toNodeId: string; maxDepth?: number; worktreeId?: string; subjectId?: string; maxNodes?: number; maxEdges?: number; maxAttributeBytes?: number }): Promise<GraphTrace>;
  graphEvents?(input: {
    projectId: string;
    kind?: GraphKind;
    worktreeId?: string;
    subjectId?: string;
    mode?: "live" | "replay";
    afterSequence?: string;
    fromSequence?: string;
    toSequence?: string;
    maxEvents?: number;
    maxBytes?: number;
  }): Promise<GraphEventsResponse>;
}

export interface PortalServerOptions {
  reader: PortalGraphReader;
  projectId: string;
  worktreeId?: string;
  subjectId?: string;
  host?: "127.0.0.1" | "::1";
  port?: number;
  sessionToken?: string;
}

export interface PortalHandle {
  server: Server;
  token: string;
  url: string;
  close(): Promise<void>;
}

const GRAPH_KINDS: readonly GraphKind[] = ["code", "impact", "work", "lineage"];
const MAX_GRAPH_NODES = 5_000;
const MAX_GRAPH_EDGES = 10_000;
const MAX_GRAPH_ATTRIBUTE_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function send(response: ServerResponse, status: number, body: string, contentType: string, headers: Record<string, string> = {}): void {
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    response.writeHead(413, { "content-type": "application/json", "x-content-type-options": "nosniff" });
    response.end(JSON.stringify({ error: "response exceeds portal frame limit" }));
    return;
  }
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  response.end(body);
}

function loopbackOrigin(host: string, port: number): string {
  return host === "::1" ? `http://[::1]:${port}` : `http://127.0.0.1:${port}`;
}

function authorized(request: IncomingMessage, host: string, port: number, token: string, api: boolean): boolean {
  const expectedHost = host === "::1" ? `[::1]:${port}` : `127.0.0.1:${port}`;
  if (request.headers.host !== expectedHost) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== loopbackOrigin(host, port)) return false;
  if (api && request.headers["x-my-pi-session"] !== token) return false;
  return true;
}

function numberParam(url: URL, name: string, fallback: number, maximum: number): number {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${name} is out of bounds`);
  return parsed;
}

function csp(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
}

export async function createPortalServer(options: PortalServerOptions): Promise<PortalHandle> {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("portal must bind to a loopback address");
  const token = options.sessionToken ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{32,128}$/.test(token)) throw new Error("portal session token is invalid");
  const nonce = createHash("sha256").update(`${token}:nonce`, "utf8").digest("base64url");
  const initial = await options.reader.graphSnapshot({ projectId: options.projectId, kind: "code", worktreeId: options.worktreeId, subjectId: options.subjectId, maxNodes: 500, maxEdges: 1_000, maxAttributeBytes: 16_384 });
  if (!validateGraphSnapshot(initial).ok) throw new Error("portal initial graph snapshot is invalid");
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "invalid"}`);
      const isEventsApi = requestUrl.pathname === "/api/graph/events";
      const isReplayApi = requestUrl.pathname === "/api/graph/replay";
      const isGraphApi = requestUrl.pathname === "/api/graph";
      const api = isGraphApi || isEventsApi || isReplayApi;
      const pageTokenValid = requestUrl.pathname !== "/" || requestUrl.searchParams.get("session") === token;
      if (!pageTokenValid || !authorized(request, host, boundPort, token, api)) {
        send(response, 403, JSON.stringify({ error: "invalid portal host, origin, or session" }), "application/json");
        return;
      }
      if (requestUrl.pathname === "/") {
        const isTheater = requestUrl.searchParams.get("view") === "theater3d";
        if (isTheater) {
          let theaterEvents: TheaterEvent[] = [];
          let throughSeq = "0";
          if (options.reader.graphEvents) {
            try {
              const evRes = await options.reader.graphEvents({
                projectId: options.projectId,
                kind: "work",
                worktreeId: options.worktreeId,
                subjectId: options.subjectId,
                maxEvents: 200,
              });
              theaterEvents = evRes.events.map((e) => ({
                ...e,
                sequence: String(e.sequence),
                payload: typeof e.payload === "object" && e.payload !== null ? (e.payload as Record<string, unknown>) : undefined,
              }));
              throughSeq = evRes.throughSequence ?? (theaterEvents.at(-1)?.sequence || "0");
            } catch {
              // degrade gracefully
            }
          }
          const initialFrame = createTheaterFrame({
            scope: {
              projectId: options.projectId,
              kind: "work",
              worktreeId: options.worktreeId,
              subjectId: options.subjectId,
            },
            graph: initial,
            events: theaterEvents,
            cursor: { lastSequence: throughSeq },
          });
          const html = renderTheaterViewHtml({
            sessionToken: token,
            nonce,
            initialFrame,
            apiBase: "/api/graph",
            isMcp: false,
          });
          send(response, 200, html, "text/html; charset=utf-8", { "content-security-policy": csp(nonce), "referrer-policy": "no-referrer" });
          return;
        }

        const html = renderGraphViewHtml({ sessionToken: token, nonce, initialSnapshot: initial, apiBase: "/api/graph" });
        send(response, 200, html, "text/html; charset=utf-8", { "content-security-policy": csp(nonce), "referrer-policy": "no-referrer" });
        return;
      }

      if (isEventsApi) {
        if (!options.reader.graphEvents) {
          send(response, 501, JSON.stringify({ error: "graph events are unavailable" }), "application/json");
          return;
        }
        const kind = requestUrl.searchParams.get("kind") as GraphKind | null;
        const mode = requestUrl.searchParams.get("mode") === "replay" ? "replay" : "live";
        const afterSequence = requestUrl.searchParams.get("afterSequence") ?? undefined;
        const fromSequence = requestUrl.searchParams.get("fromSequence") ?? undefined;
        const toSequence = requestUrl.searchParams.get("toSequence") ?? undefined;
        const maxEvents = numberParam(requestUrl, "maxEvents", 100, 1000);
        const maxBytes = numberParam(requestUrl, "maxBytes", 262144, 1048576);

        const res = await options.reader.graphEvents({
          projectId: options.projectId,
          kind: kind && GRAPH_KINDS.includes(kind) ? kind : undefined,
          worktreeId: options.worktreeId,
          subjectId: options.subjectId,
          mode,
          afterSequence,
          fromSequence,
          toSequence,
          maxEvents,
          maxBytes,
        });
        send(response, 200, JSON.stringify(res), "application/json", { "content-security-policy": "default-src 'none'" });
        return;
      }

      if (isReplayApi) {
        if (!options.reader.graphEvents) {
          send(response, 501, JSON.stringify({ error: "graph replay are unavailable" }), "application/json");
          return;
        }
        const kind = requestUrl.searchParams.get("kind") as GraphKind | null;
        const fromSequence = requestUrl.searchParams.get("fromSequence") ?? undefined;
        const toSequence = requestUrl.searchParams.get("toSequence") ?? undefined;
        const maxEvents = numberParam(requestUrl, "maxEvents", 200, 1000);
        const maxBytes = numberParam(requestUrl, "maxBytes", 524288, 1048576);

        const res = await options.reader.graphEvents({
          projectId: options.projectId,
          kind: kind && GRAPH_KINDS.includes(kind) ? kind : undefined,
          worktreeId: options.worktreeId,
          subjectId: options.subjectId,
          mode: "replay",
          fromSequence,
          toSequence,
          maxEvents,
          maxBytes,
        });
        send(response, 200, JSON.stringify(res), "application/json", { "content-security-policy": "default-src 'none'" });
        return;
      }

      if (isGraphApi) {
        const kind = requestUrl.searchParams.get("kind");
        if (!kind || !GRAPH_KINDS.includes(kind as GraphKind)) {
          send(response, 400, JSON.stringify({ error: "kind is invalid" }), "application/json");
          return;
        }
        const query = {
          projectId: options.projectId,
          kind: kind as GraphKind,
          worktreeId: options.worktreeId,
          subjectId: options.subjectId,
          maxNodes: numberParam(requestUrl, "maxNodes", 500, MAX_GRAPH_NODES),
          maxEdges: numberParam(requestUrl, "maxEdges", 1_000, MAX_GRAPH_EDGES),
          maxAttributeBytes: numberParam(requestUrl, "maxAttributeBytes", 16_384, MAX_GRAPH_ATTRIBUTE_BYTES),
        };
        const operation = requestUrl.searchParams.get("operation") ?? "snapshot";
        let snapshot: GraphSnapshot;
        if (operation === "snapshot") {
          snapshot = await options.reader.graphSnapshot(query);
        } else if (operation === "expand") {
          if (!options.reader.graphExpand) {
            send(response, 501, JSON.stringify({ error: "bounded graph expansion is unavailable" }), "application/json");
            return;
          }
          const nodeId = requestUrl.searchParams.get("nodeId");
          if (!nodeId || nodeId.length > 512) {
            send(response, 400, JSON.stringify({ error: "nodeId is invalid" }), "application/json");
            return;
          }
          snapshot = await options.reader.graphExpand({ ...query, nodeId, depth: numberParam(requestUrl, "depth", 1, 8) });
        } else if (operation === "trace") {
          if (!options.reader.graphTrace) {
            send(response, 501, JSON.stringify({ error: "bounded graph trace is unavailable" }), "application/json");
            return;
          }
          const fromNodeId = requestUrl.searchParams.get("fromNodeId");
          const toNodeId = requestUrl.searchParams.get("toNodeId");
          if (!fromNodeId || fromNodeId.length > 512 || !toNodeId || toNodeId.length > 512) {
            send(response, 400, JSON.stringify({ error: "trace endpoints are invalid" }), "application/json");
            return;
          }
          const trace = await options.reader.graphTrace({ ...query, fromNodeId, toNodeId, maxDepth: numberParam(requestUrl, "depth", 1, 8) });
          const traceJson = JSON.stringify(trace);
          if (Buffer.byteLength(traceJson, "utf8") > MAX_RESPONSE_BYTES) {
            send(response, 413, JSON.stringify({ error: "trace response exceeds portal frame limit" }), "application/json");
            return;
          }
          send(response, 200, traceJson, "application/json", { "content-security-policy": "default-src 'none'" });
          return;
        } else {
          send(response, 400, JSON.stringify({ error: "operation is invalid" }), "application/json");
          return;
        }
        const validation = validateGraphSnapshot(snapshot);
        if (!validation.ok) throw new Error(`daemon returned invalid graph snapshot: ${validation.errors.join(", ")}`);
        send(response, 200, JSON.stringify(snapshot), "application/json", { "content-security-policy": "default-src 'none'" });
        return;
      }
      send(response, 404, JSON.stringify({ error: "not found" }), "application/json");
    } catch (error) {
      send(response, 400, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), "application/json");
    }
  });
  let boundPort = options.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); boundPort = (server.address() as { port: number }).port; resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(boundPort, host);
  });
  return { server, token, url: `${loopbackOrigin(host, boundPort)}/?session=${encodeURIComponent(token)}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
