/**
 * Pure Node correctness fallback for walk/glob/grep (A14). May be slower than
 * native; results are semantically equivalent for the required corpus.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { isLikelyBinary } from "@ccr/contracts";
import type { SearchBackend, SearchRequest, SearchResult } from "@ccr/native-ports";

function segmentToRegex(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else if ("\\^$.|+()[]{}".includes(ch)) out += "\\" + ch;
    else out += ch;
  }
  return out;
}

export function globToRegex(pattern: string): RegExp {
  const segments = pattern.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "**") out.push("(?:[^/]+/)*[^/]*");
    else if (seg === "") continue;
    else out.push(segmentToRegex(seg));
  }
  return new RegExp(`^${out.join("/")}$`);
}

async function loadGitignore(root: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return raw.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function isIgnored(relPosix: string, rules: string[]): boolean {
  for (const rule of rules) {
    const r = rule.replace(/^\/+/, "").replace(/\/+$/, "");
    if (r === "") continue;
    if (relPosix === r || relPosix.startsWith(r + "/") || relPosix.split("/").includes(r)) return true;
  }
  return false;
}

async function walkFiles(
  root: string,
  opts: { signal?: AbortSignal; skipHidden: boolean; gitignore: boolean },
): Promise<string[]> {
  const rules = opts.gitignore ? await loadGitignore(root) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  async function walk(dir: string, rel: string): Promise<void> {
    opts.signal?.throwIfAborted();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (opts.skipHidden && name.startsWith(".")) continue;
      const relPath = rel === "" ? name : `${rel}/${name}`;
      if (isIgnored(relPath, rules)) continue;
      const abs = path.join(dir, name);
      if (e.isDirectory()) {
        await walk(abs, relPath);
      } else if (e.isFile()) {
        if (!seen.has(relPath)) {
          seen.add(relPath);
          out.push(relPath);
        }
      }
    }
  }
  await walk(root, "");
  return out;
}

export class NodeFallbackSearchBackend implements SearchBackend {
  readonly kind = "node-fallback" as const;
  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    const root = request.roots?.[0] ?? ".";
    const files = await walkFiles(root, {
      signal,
      skipHidden: request.ignoreGitignore !== undefined ? true : false,
      gitignore: !(request.ignoreGitignore ?? false),
    });
    if (request.mode === "glob") {
      const re = globToRegex(request.pattern);
      const matches = files.filter((f) => re.test(f)).slice(0, request.limit ?? 100);
      const totalCount = files.filter((f) => re.test(f)).length;
      return {
        matches: matches.map((f) => ({ path: f, text: f })),
        truncated: totalCount > (request.limit ?? 100),
        totalCount,
      };
    }
    const flags = request.caseSensitive ? "" : "i";
    let re: RegExp;
    try {
      re = new RegExp(request.pattern, flags);
    } catch {
      re = new RegExp(request.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    }
    const limit = request.limit ?? 200;
    const matches: SearchResult["matches"] = [];
    let totalCount = 0;
    for (const rel of files) {
      signal.throwIfAborted();
      const abs = path.join(root, rel);
      let raw: Buffer;
      try {
        raw = await fs.readFile(abs);
      } catch {
        continue;
      }
      if (isLikelyBinary(new Uint8Array(raw))) continue;
      let text: string;
      try {
        text = raw.toString("utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const m = re.exec(line);
        if (!m) continue;
        totalCount++;
        if (matches.length >= limit) break;
        matches.push({
          path: rel,
          line: i + 1,
          column: (m.index ?? 0) + 1,
          text: line,
          before: request.contextBefore ? lines.slice(Math.max(0, i - request.contextBefore), i) : undefined,
          after: request.contextAfter ? lines.slice(i + 1, i + 1 + request.contextAfter) : undefined,
        });
      }
      if (matches.length >= limit) break;
    }
    return { matches, truncated: totalCount > limit, totalCount };
  }
}
