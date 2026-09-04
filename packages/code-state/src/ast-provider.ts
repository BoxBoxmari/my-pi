import path from "node:path";
import { detectAstLanguage, TreeSitterAstBackend } from "@my-pi/ast";
import type { CodeEdge, CodeEntity } from "@my-pi/contracts";
import type { CodeGraphDelta, IndexContext } from "./model.js";
import { fileStableKey, moduleStableKey, relativePosix, stableEntityId, symbolStableKey } from "./identity.js";
import type { CodeStateProvider } from "./provider.js";

const QUERY_SETS: Record<string, Array<{ kind: "function" | "class" | "interface" | "type" | "import"; pattern: string }>> = {
  typescript: [
    { kind: "function", pattern: "(function_declaration name: (identifier) @name)" },
    { kind: "class", pattern: "(class_declaration name: (_) @name)" },
    { kind: "interface", pattern: "(interface_declaration name: (_) @name)" },
    { kind: "type", pattern: "(type_alias_declaration name: (_) @name)" },
    { kind: "import", pattern: "(import_statement) @import" },
  ],
  javascript: [
    { kind: "function", pattern: "(function_declaration name: (identifier) @name)" },
    { kind: "class", pattern: "(class_declaration name: (_) @name)" },
    { kind: "import", pattern: "(import_statement) @import" },
  ],
  python: [
    { kind: "function", pattern: "(function_definition name: (identifier) @name)" },
    { kind: "class", pattern: "(class_definition name: (identifier) @name)" },
    { kind: "import", pattern: "(import_statement) @import" },
    { kind: "import", pattern: "(import_from_statement) @import" },
  ],
  rust: [
    { kind: "function", pattern: "(function_item name: (identifier) @name)" },
    { kind: "class", pattern: "(struct_item name: (_) @name)" },
    { kind: "type", pattern: "(enum_item name: (_) @name)" },
    { kind: "import", pattern: "(use_declaration) @import" },
  ],
  go: [
    { kind: "function", pattern: "(function_declaration name: (identifier) @name)" },
    { kind: "type", pattern: "(type_spec name: (_) @name)" },
    { kind: "import", pattern: "(import_declaration) @import" },
  ],
};

function importSpecifier(raw: string): string | undefined {
  const quoted = raw.match(/\bfrom\s*["']([^"']+)["']/) ?? raw.match(/^\s*import\s*["']([^"']+)["']/) ?? raw.match(/\b(?:require|use)\s*\(?\s*["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1];
  const bare = raw.match(/^\s*from\s+([A-Za-z0-9_./:-]+)/);
  return bare?.[1];
}

/** Resolve only workspace-local imports; never traverse node_modules or outside the authority root. */
async function resolveWorkspaceImport(context: IndexContext, importer: string, specifier: string): Promise<string | undefined> {
  if (specifier.startsWith("node:")) return undefined;
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(context.root, path.dirname(importer), specifier);
  } else {
    const packageMatch = specifier.match(/^@my-pi\/([^/]+)(?:\/(.*))?$/);
    if (!packageMatch) return undefined;
    base = path.join(context.root, "packages", packageMatch[1]!, "src", packageMatch[2] ?? "index");
  }
  const withoutRuntimeExtension = base.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx)$/i, "");
  const candidates = [base, withoutRuntimeExtension, `${withoutRuntimeExtension}.ts`, `${withoutRuntimeExtension}.tsx`, `${withoutRuntimeExtension}.js`, `${withoutRuntimeExtension}.jsx`, `${withoutRuntimeExtension}.mjs`, `${withoutRuntimeExtension}.cjs`, path.join(withoutRuntimeExtension, "index.ts"), path.join(withoutRuntimeExtension, "index.js")];
  for (const candidate of candidates) {
    try {
      const resolved = await context.resolveReadPath(candidate);
      if (resolved.exists) return resolved.relPosix;
    } catch {
      // Missing or protected imports are not followed and never bypass policy.
    }
  }
  return undefined;
}

export class AstCodeStateProvider implements CodeStateProvider {
  readonly name = "ast";
  private readonly backend = new TreeSitterAstBackend();

  supports(filePath: string): boolean {
    return detectAstLanguage(filePath) !== undefined;
  }

  async indexFile(context: IndexContext, filePath: string): Promise<CodeGraphDelta> {
    const resolved = await context.resolveReadPath(filePath);
    const absolute = resolved.absolute;
    const relativePath = resolved.relPosix;
    const language = detectAstLanguage(absolute);
    const observedAt = new Date().toISOString();
    if (!resolved.exists) return { provider: this.name, changedPath: relativePath, entities: [], edges: [], removedStableKeys: [], observedAt, providerHealth: { ast: { status: "ready" } } };
    if (!language) return { provider: this.name, changedPath: relativePath, entities: [], edges: [], removedStableKeys: [], observedAt, providerHealth: { ast: { status: "unavailable", message: "language is not supported by the existing AST provider" } } };
    const fileId = stableEntityId(fileStableKey(context.repositoryIdentity, relativePath));
    const entities = new Map<string, CodeEntity>();
    const edges = new Map<string, CodeEdge>();
    const queries = QUERY_SETS[language] ?? [];
    let succeeded = 0;
    const failures: string[] = [];
    for (const query of queries) {
      context.signal.throwIfAborted();
      try {
        const result = await this.backend.search({ pattern: query.pattern, paths: [absolute], mode: "query", limit: 200 }, context.signal);
        succeeded++;
        for (const match of result.matches) {
          const rawName = query.kind === "import" ? match.captures.import ?? match.text : match.captures.name;
          const name = query.kind === "import" ? importSpecifier(String(rawName)) ?? String(rawName) : rawName;
          if (!name) continue;
          const stableKey = query.kind === "import"
            ? moduleStableKey(context.repositoryIdentity, relativePath, name)
            : symbolStableKey(context.repositoryIdentity, relativePath, query.kind, name, match.range.start.line);
          const id = stableEntityId(stableKey);
          entities.set(stableKey, {
            id,
            projectId: context.projectId,
            repositoryId: context.repositoryId,
            worktreeId: context.worktreeId,
            kind: query.kind === "import" ? "module" : "symbol",
            stableKey,
            displayName: name,
            path: relativePath,
            ...(query.kind === "import" ? {} : { symbolKind: query.kind }),
            observedAt,
            provider: "ast",
          });
          const edge: CodeEdge = {
            from: fileId,
            to: id,
            kind: query.kind === "import" ? "imports" : "contains",
            confidence: query.kind === "import" ? "strong" : "exact",
            provider: "ast",
            observedAt,
          };
          edges.set(`${edge.from}|${edge.to}|${edge.kind}`, edge);
          if (query.kind === "import") {
            const resolvedImport = await resolveWorkspaceImport(context, relativePath, name);
            if (resolvedImport && resolvedImport !== relativePath) {
              const resolvedId = stableEntityId(fileStableKey(context.repositoryIdentity, resolvedImport));
              edges.set(`${fileId}|${resolvedId}|resolved-import`, { ...edge, to: resolvedId, confidence: "strong" });
            }
          }
        }
      } catch (error) {
        failures.push(`${query.kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      provider: this.name,
      changedPath: relativePath,
      entities: [...entities.values()],
      edges: [...edges.values()],
      removedStableKeys: [],
      observedAt,
      providerHealth: {
        ast: succeeded > 0
          ? { status: failures.length > 0 ? "degraded" : "ready", ...(failures.length > 0 ? { message: failures.slice(0, 3).join("; ") } : {}) }
          : { status: "degraded", message: failures.slice(0, 3).join("; ") || "no AST query could be evaluated" },
      },
    };
  }

  async invalidate(context: IndexContext, paths: string[]): Promise<CodeGraphDelta[]> {
    return paths.map((filePath) => ({ provider: this.name, changedPath: relativePosix(context.root, path.resolve(context.root, filePath)), entities: [], edges: [], removedStableKeys: [], observedAt: new Date().toISOString(), providerHealth: { ast: { status: "ready" } } }));
  }
}
