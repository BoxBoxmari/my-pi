import path from "node:path";
import fs from "node:fs";

/**
 * Root detection: precedence of markers (e.g., tsconfig.json, Cargo.toml, pyproject.toml).
 */
export const ROOT_MARKERS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "package.json"],
  javascript: ["package.json", "jsconfig.json"],
  python: ["pyproject.toml", "setup.py", "requirements.txt", "pyrightconfig.json"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
};

export const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

export function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext];
}

export function detectRoot(files: string[], language: string): string | undefined {
  const markers = ROOT_MARKERS[language] ?? [];
  return markers.find((m) => files.includes(m));
}

export function findWorkspaceRoot(startDir: string, language: string, boundaryRoot = startDir): string {
  const markers = ROOT_MARKERS[language] ?? [];
  let cur = path.resolve(startDir);
  const boundary = path.resolve(boundaryRoot);
  while (true) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(cur, marker))) {
        return cur;
      }
    }
    if (cur === boundary) break;
    const parent = path.dirname(cur);
    if (parent === cur || !parent.startsWith(`${boundary}${path.sep}`)) break;
    cur = parent;
  }
  return startDir;
}

