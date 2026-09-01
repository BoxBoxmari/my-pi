import path from "node:path";
import fs from "node:fs";

/**
 * LspRegistry key: workspace_id + language/server identity + config hash.
 */
export type LspRegistryKey = string;
export function registryKey(workspaceId: string, language: string, configHash = "default"): LspRegistryKey {
  return `${workspaceId}:${language}:${configHash}`;
}

export interface LanguageServerSpec {
  language: "typescript" | "python" | "rust" | "go" | string;
  commandCandidates: string[];
  args: string[];
  rootMarkers: string[];
  fileExtensions: string[];
}

export const SUPPORTED_SERVERS: Record<string, LanguageServerSpec> = {
  typescript: {
    language: "typescript",
    commandCandidates: [
      process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server",
      "typescript-language-server",
    ],
    args: ["--stdio"],
    rootMarkers: ["tsconfig.json", "package.json"],
    fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  },
  python: {
    language: "python",
    commandCandidates: [
      process.platform === "win32" ? "pyright-langserver.cmd" : "pyright-langserver",
      "pyright-langserver",
      process.platform === "win32" ? "pylsp.exe" : "pylsp",
      "pylsp",
    ],
    args: ["--stdio"],
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "pyrightconfig.json"],
    fileExtensions: [".py", ".pyi"],
  },
  rust: {
    language: "rust",
    commandCandidates: [
      process.platform === "win32" ? "rust-analyzer.exe" : "rust-analyzer",
      "rust-analyzer",
    ],
    args: [],
    rootMarkers: ["Cargo.toml"],
    fileExtensions: [".rs"],
  },
  go: {
    language: "go",
    commandCandidates: [
      process.platform === "win32" ? "gopls.exe" : "gopls",
      "gopls",
    ],
    args: ["serve"],
    rootMarkers: ["go.mod"],
    fileExtensions: [".go"],
  },
};

/**
 * Resolves the executable path for a language server:
 * 1. Checks node_modules/.bin (from cwd or repo root)
 * 2. Checks system PATH
 */
export function resolveServerCommand(language: string, cwd = process.cwd()): { command: string; args: string[] } | undefined {
  const spec = SUPPORTED_SERVERS[language];
  if (!spec) return undefined;

  const isWin = process.platform === "win32";
  const searchBinDirs = [
    path.resolve(process.cwd(), "node_modules", ".bin"),
    path.resolve(cwd, "node_modules", ".bin"),
  ];

  let cur = path.resolve(cwd);
  while (true) {
    searchBinDirs.push(path.join(cur, "node_modules", ".bin"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  for (const candidate of spec.commandCandidates) {
    for (const binDir of searchBinDirs) {
      const localBin = path.join(binDir, candidate);
      if (fs.existsSync(localBin)) {
        return { command: localBin, args: spec.args };
      }
    }

    // Check system PATH
    const envPath = process.env.PATH ?? "";
    const dirs = envPath.split(path.delimiter);
    for (const d of dirs) {
      const p = path.join(d, candidate);
      if (fs.existsSync(p)) {
        return { command: p, args: spec.args };
      }
      if (isWin && !candidate.endsWith(".exe") && !candidate.endsWith(".cmd") && !candidate.endsWith(".bat")) {
        for (const ext of [".exe", ".cmd", ".bat"]) {
          if (fs.existsSync(p + ext)) {
            return { command: p + ext, args: spec.args };
          }
        }
      }
    }
  }

  // Fallback to first candidate
  return { command: spec.commandCandidates[0]!, args: spec.args };
}

