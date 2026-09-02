import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import {
  err,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "@my-pi/contracts";
import type {
  AstBackend,
  AstSearchRequest,
  AstSearchResult,
} from "@my-pi/native-ports";
import type { WorkspaceRuntime } from "@my-pi/workspace-runtime";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");

export const AST_LANGUAGES = ["typescript", "javascript", "python", "rust", "go"] as const;
export type AstLanguage = (typeof AST_LANGUAGES)[number];

export const EXTENSION_TO_LANG: Record<string, AstLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

export function detectAstLanguage(filePath: string): AstLanguage | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANG[ext];
}

export class TreeSitterAstBackend implements AstBackend {
  readonly kind = "node-fallback" as const;
  private initialized = false;
  private parser: any = null;
  private readonly languages = new Map<AstLanguage, any>();

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await Parser.init();
    this.parser = new Parser();
    this.initialized = true;
  }

  private resolveWasmPath(lang: AstLanguage): string {
    const wasmName = `tree-sitter-${lang}.wasm`;
    const searchDirs = [
      path.resolve(process.cwd(), "node_modules", "tree-sitter-wasms", "out"),
      path.resolve(process.cwd(), "packages", "ast", "node_modules", "tree-sitter-wasms", "out"),
    ];

    let cur = path.resolve(process.cwd());
    while (true) {
      searchDirs.push(path.join(cur, "node_modules", "tree-sitter-wasms", "out"));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }

    try {
      const resolved = require.resolve(`tree-sitter-wasms/out/${wasmName}`);
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      // ignore
    }

    for (const dir of searchDirs) {
      const p = path.join(dir, wasmName);
      if (fs.existsSync(p)) return p;
    }

    throw new Error(`Tree-sitter WASM not found for language: ${lang}`);
  }

  private async getLanguage(lang: AstLanguage): Promise<any> {
    await this.ensureInitialized();
    let loaded = this.languages.get(lang);
    if (!loaded) {
      const wasmPath = this.resolveWasmPath(lang);
      loaded = await Parser.Language.load(wasmPath);
      this.languages.set(lang, loaded);
    }
    return loaded;
  }

  async search(request: AstSearchRequest, signal: AbortSignal): Promise<AstSearchResult> {
    signal.throwIfAborted();
    await this.ensureInitialized();

    const limit = request.limit ?? 50;
    const matches: AstSearchResult["matches"] = [];
    let totalCount = 0;

    for (const filePath of request.paths) {
      signal.throwIfAborted();

      const lang = detectAstLanguage(filePath);
      if (!lang) continue;

      let content: string;
      try {
        content = await fs.promises.readFile(filePath, "utf8");
      } catch {
        continue;
      }

      let treeLanguage: any;
      try {
        treeLanguage = await this.getLanguage(lang);
      } catch {
        continue;
      }

      this.parser.setLanguage(treeLanguage);
      const tree = this.parser.parse(content);
      const rootNode = tree.rootNode;

      const isQueryPattern = request.pattern.startsWith("(") || request.pattern.includes("@");

      if (isQueryPattern) {
        try {
          const query = treeLanguage.query(request.pattern);
          const queryMatches = query.matches(rootNode);

          for (const qm of queryMatches) {
            signal.throwIfAborted();
            totalCount++;
            if (matches.length < limit) {
              const capturesMap: Record<string, string> = {};
              let primaryNode = qm.captures[0]?.node ?? rootNode;

              for (const cap of qm.captures) {
                capturesMap[cap.name] = cap.node.text;
                if (cap.name === "match" || cap.name === "target" || cap.name === "name") {
                  primaryNode = cap.node;
                }
              }

              matches.push({
                path: filePath,
                range: {
                  start: { line: primaryNode.startPosition.row, column: primaryNode.startPosition.column },
                  end: { line: primaryNode.endPosition.row, column: primaryNode.endPosition.column },
                },
                captures: capturesMap,
                text: primaryNode.text,
              });
            }
          }
        } catch {
          // If query parsing fails, fallback to structural node walker
          this.walkNodes(rootNode, request.pattern, filePath, matches, limit, () => {
            totalCount++;
          }, signal);
        }
      } else {
        this.walkNodes(rootNode, request.pattern, filePath, matches, limit, () => {
          totalCount++;
        }, signal);
      }
    }

    return {
      matches,
      truncated: totalCount > limit,
      totalCount,
    };
  }

  private walkNodes(
    node: any,
    pattern: string,
    filePath: string,
    matches: AstSearchResult["matches"],
    limit: number,
    incrementTotal: () => void,
    signal: AbortSignal,
  ): void {
    signal.throwIfAborted();

    const lowerPattern = pattern.toLowerCase();
    const typeMatch = node.type.toLowerCase().includes(lowerPattern);
    const textMatch = node.text && node.text.toLowerCase().includes(lowerPattern) && node.text.length < 500;

    // Check if current node represents a match
    if (typeMatch || (textMatch && node.childCount === 0)) {
      incrementTotal();
      if (matches.length < limit) {
        matches.push({
          path: filePath,
          range: {
            start: { line: node.startPosition.row, column: node.startPosition.column },
            end: { line: node.endPosition.row, column: node.endPosition.column },
          },
          captures: { type: node.type, text: node.text },
          text: node.text,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.walkNodes(child, pattern, filePath, matches, limit, incrementTotal, signal);
      }
    }
  }
}

export class FallbackAstBackend extends TreeSitterAstBackend {}

type Ctx = CapabilityContext;

function result<T>(
  ctx: Ctx,
  data: T,
  startedAt: number,
  extra?: Partial<Pick<CapabilityResult<T>, "backend" | "degraded" | "warnings">>,
): CapabilityResult<T> {
  const totalMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  return {
    schemaVersion: "1",
    requestId: ctx.requestId,
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    data,
    timing: { totalMs },
    backend: "node-fallback",
    ...extra,
  };
}

export interface AstSearchInput {
  pattern: string;
  paths?: string[];
}

export function createAstCapabilities(
  runtime: WorkspaceRuntime,
  backend: AstBackend = new TreeSitterAstBackend(),
): Map<string, Capability<unknown, unknown>> {
  const map = new Map<string, Capability<unknown, unknown>>();

  map.set("ast_search", {
    name: "ast_search",
    risk: "read",
    async execute(input: unknown, ctx: Ctx) {
      const t0 = performance.now();
      const { pattern, paths: inputPaths = [] } = input as AstSearchInput;

      if (!pattern || typeof pattern !== "string") {
        throw err.invalidArgument("pattern is required for ast_search");
      }

      // Resolve candidate file paths within workspace
      const targetPaths: string[] = [];
      if (inputPaths.length > 0) {
        for (const p of inputPaths) {
          try {
            const resolved = await runtime.pathPolicy.resolveForRead(ctx.workspace, p);
            targetPaths.push(resolved.absolute);
          } catch {
            // ignore inaccessible / non-existent paths
          }
        }
      } else {
        // Collect files in workspace matching AST languages
        const walkDir = async (dir: string): Promise<void> => {
          ctx.signal.throwIfAborted();
          let entries: fs.Dirent[];
          try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            ctx.signal.throwIfAborted();
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "target" || e.name === "dist") {
              continue;
            }
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              await walkDir(full);
            } else if (e.isFile() && detectAstLanguage(full)) {
              try {
                const rel = path.relative(ctx.workspace.root, full);
                await runtime.pathPolicy.resolveForRead(ctx.workspace, rel);
                targetPaths.push(full);
              } catch {
                // skip denied
              }
            }
          }
        };
        await walkDir(ctx.workspace.root);
      }

      const res = await backend.search({ pattern, paths: targetPaths }, ctx.signal);

      // Map absolute paths back to workspace-relative POSIX paths
      const formattedMatches = res.matches.map((m) => ({
        ...m,
        path: path.relative(ctx.workspace.root, m.path).replace(/\\/g, "/"),
      }));

      return result(
        ctx,
        {
          matches: formattedMatches,
          truncated: res.truncated,
          totalCount: res.totalCount,
        },
        t0,
      );
    },
  });

  return map;
}
