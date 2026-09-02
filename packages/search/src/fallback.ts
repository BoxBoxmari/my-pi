/**
 * Pure Node correctness fallback for walk/glob/grep (A14).
 *
 * P0.2: `request.allowed` is enforced during traversal, BEFORE any file is
 * opened. A denied path is never read; denied directories are not descended
 * into when detectable from the path shape.
 * P1.5 (Contract A): totalCount is exact — counting continues past the
 * inline result limit; `truncated` reflects the exact overflow.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { isLikelyBinary } from "@my-pi/contracts";
import type { SearchBackend, SearchRequest, SearchResult } from "@my-pi/native-ports";

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
  const norm = pattern.replace(/\\/g, "/");
  if (!norm.includes("/")) {
    const r = segmentToRegex(norm);
    return new RegExp(`(?:^|/)${r}$`);
  }
  const segments = norm.split("/");
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === "**") {
      if (i === segments.length - 1) {
        out.push(".*");
      } else {
        out.push("(?:.+/)?");
      }
    } else if (seg === "") {
      continue;
    } else {
      out.push(segmentToRegex(seg) + (i < segments.length - 1 ? "/" : ""));
    }
  }
  return new RegExp(`^${out.join("")}$`);
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
  opts: {
    signal?: AbortSignal;
    skipHidden: boolean;
    gitignore: boolean;
    allowed?: (relPosix: string, isDirectory: boolean) => boolean;
  },
): Promise<string[]> {
  const rules = opts.gitignore ? await loadGitignore(root) : [];
  const out: string[] = [];

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
        // P0.2: deny directory before descent when a rule matches the dir path.
        if (opts.allowed && !opts.allowed(relPath, true)) continue;
        await walk(abs, relPath);
      } else if (e.isFile()) {
        // P0.2: deny file before it is ever opened.
        if (opts.allowed && !opts.allowed(relPath, false)) continue;
        out.push(relPath);
      }
    }
  }

  await walk(root, "");
  return out;
}

export class NodeFallbackSearchBackend implements SearchBackend {
  readonly kind = "node-fallback" as const;

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    const root = request.roots?.[0];
    if (root === undefined || root === "" || root === ".") {
      throw new Error("NodeFallbackSearchBackend requires a resolved absolute root");
    }
    const files = await walkFiles(root, {
      signal,
      skipHidden: true,
      gitignore: !(request.ignoreGitignore ?? false),
      allowed: request.allowed,
    });

    if (request.mode === "glob") {
      const re = globToRegex(request.pattern);
      const all = files.filter((f) => re.test(f));
      const limit = request.limit ?? 100;
      return {
        matches: all.slice(0, limit).map((f) => ({ path: f, text: f })),
        truncated: all.length > limit,
        totalCount: all.length, // Contract A: exact
      };
    }

    // grep — exact counting past the inline limit (Contract A).
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
      request.onFileRead?.(rel); // instrumentation: prove what is about to be read
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
        totalCount++; // exact: count continues past inline limit
        if (matches.length < limit) {
          matches.push({
            path: rel,
            line: i + 1,
            column: (m.index ?? 0) + 1,
            text: line,
            before: request.contextBefore ? lines.slice(Math.max(0, i - request.contextBefore), i) : undefined,
            after: request.contextAfter ? lines.slice(i + 1, i + 1 + request.contextAfter) : undefined,
          });
        }
      }
    }
    return { matches, truncated: totalCount > limit, totalCount };
  }
}
