/**
 * Pure Node.js search fallback.
 *
 * Traversal and file reads are incremental. Sensitive-path authorization is
 * still evaluated before a candidate file is opened.
 */
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isLikelyBinary } from "@my-pi/contracts";
import type { SearchBackend, SearchMatch, SearchRequest, SearchResult } from "@my-pi/native-ports";

export const MAX_SEARCH_PATTERN_BYTES = 4096;
export const MAX_SEARCH_CONTEXT_LINES = 20;
export const MAX_SEARCH_LINE_BYTES = 1024 * 1024;
const STREAM_HIGH_WATER_MARK = 64 * 1024;

interface IgnoreRule {
  base: string;
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

function trimUnescapedTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === " " && (end < 2 || value[end - 2] !== "\\")) end--;
  return value.slice(0, end);
}

function unescapePattern(value: string): string {
  return value.replace(/\\([\\#! ])/g, "$1");
}

function parseIgnoreRule(rawLine: string, base: string): IgnoreRule | undefined {
  let line = trimUnescapedTrailingSpaces(rawLine.replace(/\r$/, ""));
  if (line === "" || (line.startsWith("#") && !line.startsWith("\\#"))) return undefined;

  let negated = false;
  if (line.startsWith("!") && !line.startsWith("\\!")) {
    negated = true;
    line = line.slice(1);
  }
  line = unescapePattern(line);
  if (line === "") return undefined;

  const directoryOnly = line.endsWith("/");
  if (directoryOnly) line = line.slice(0, -1);
  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  if (line === "") return undefined;
  return { base, pattern: line, negated, directoryOnly, anchored };
}

async function loadGitignore(dir: string, base: string): Promise<IgnoreRule[]> {
  try {
    const raw = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
    return raw.split(/\r?\n/).map((line) => parseIgnoreRule(line, base)).filter((rule): rule is IgnoreRule => rule !== undefined);
  } catch {
    return [];
  }
}

function globToRegex(pattern: string, basenameAnywhere = false): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }
  return !pattern.includes("/") && basenameAnywhere
    ? new RegExp(`^(?:.*/)?${source}$`)
    : new RegExp(`^${source}$`);
}

function relativeToRuleBase(relPath: string, base: string): string | undefined {
  if (base === "") return relPath;
  if (relPath === base) return "";
  if (!relPath.startsWith(`${base}/`)) return undefined;
  return relPath.slice(base.length + 1);
}

function matchesRule(relPath: string, isDirectory: boolean, rule: IgnoreRule): boolean {
  const relative = relativeToRuleBase(relPath, rule.base);
  if (relative === undefined || relative === "") return false;
  const regex = globToRegex(rule.pattern);
  const matchesPath = (candidate: string): boolean => {
    if (!rule.anchored && !rule.pattern.includes("/")) {
      return candidate.split("/").some((segment) => regex.test(segment));
    }
    return regex.test(candidate);
  };

  if (!rule.directoryOnly) return matchesPath(relative);
  const segments = relative.split("/");
  const candidates = isDirectory ? [relative] : segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
  return candidates.some((candidate) => matchesPath(candidate));
}

function isIgnored(relPath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (matchesRule(relPath, isDirectory, rule)) ignored = !rule.negated;
  }
  return ignored;
}

function mayHaveNegatedDescendant(relPath: string, rules: IgnoreRule[]): boolean {
  return rules.some((rule) => rule.negated && (rule.base === relPath || rule.base.startsWith(`${relPath}/`) || rule.pattern.startsWith(`${relPath}/`)));
}

async function* walkFiles(
  root: string,
  opts: {
    signal?: AbortSignal;
    skipHidden: boolean;
    gitignore: boolean;
    allowed?: (relPosix: string, isDirectory: boolean) => boolean;
  },
): AsyncGenerator<string> {
  async function* walk(dir: string, rel: string, inheritedRules: IgnoreRule[]): AsyncGenerator<string> {
    opts.signal?.throwIfAborted();
    const rules = opts.gitignore
      ? [...inheritedRules, ...(await loadGitignore(dir, rel))]
      : inheritedRules;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      opts.signal?.throwIfAborted();
      const name = entry.name;
      if (opts.skipHidden && name.startsWith(".")) continue;
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const absolute = path.join(dir, name);
      if (entry.isDirectory()) {
        if (isIgnored(relPath, true, rules) && !mayHaveNegatedDescendant(relPath, rules)) continue;
        if (opts.allowed && !opts.allowed(relPath, true)) continue;
        yield* walk(absolute, relPath, rules);
      } else if (entry.isFile()) {
        if (isIgnored(relPath, false, rules)) continue;
        if (opts.allowed && !opts.allowed(relPath, false)) continue;
        yield relPath;
      }
    }
  }

  yield* walk(root, "", []);
}

function validatePattern(pattern: string): void {
  if (Buffer.byteLength(pattern, "utf8") > MAX_SEARCH_PATTERN_BYTES) {
    throw new Error(`search pattern exceeds ${MAX_SEARCH_PATTERN_BYTES} bytes`);
  }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const sample = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return isLikelyBinary(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function searchTextFile(
  root: string,
  rel: string,
  re: RegExp,
  request: SearchRequest,
  signal: AbortSignal,
  matches: SearchMatch[],
  state: { totalCount: number },
  limit: number,
): Promise<void> {
  if (await isBinaryFile(path.join(root, rel))) return;
  const stream = createReadStream(path.join(root, rel), { highWaterMark: STREAM_HIGH_WATER_MARK });
  const decoder = new StringDecoder("utf8");
  const beforeLimit = Math.min(request.contextBefore ?? 0, MAX_SEARCH_CONTEXT_LINES);
  const afterLimit = Math.min(request.contextAfter ?? 0, MAX_SEARCH_CONTEXT_LINES);
  const previous: string[] = [];
  const pendingAfter: Array<{ match: SearchMatch; remaining: number }> = [];

  try {
    let lineNumber = 0;
    let lineBuffer = "";
    let discardingOversizedLine = false;
    const consumeLine = async (line: string): Promise<void> => {
      lineNumber++;
      if (Buffer.byteLength(line, "utf8") > MAX_SEARCH_LINE_BYTES) return;
      for (let i = pendingAfter.length - 1; i >= 0; i--) {
        const pending = pendingAfter[i]!;
        if (pending.remaining <= 0) {
          pendingAfter.splice(i, 1);
          continue;
        }
        pending.match.after?.push(line);
        pending.remaining--;
      }

      const match = re.exec(line);
      if (match) {
        state.totalCount++;
        if (matches.length < limit) {
          const item: SearchMatch = {
            path: rel,
            line: lineNumber,
            column: (match.index ?? 0) + 1,
            text: line,
            before: beforeLimit > 0 ? [...previous] : undefined,
            after: afterLimit > 0 ? [] : undefined,
          };
          matches.push(item);
          if (afterLimit > 0) pendingAfter.push({ match: item, remaining: afterLimit });
        }
      }

      if (beforeLimit > 0) {
        previous.push(line);
        while (previous.length > beforeLimit) previous.shift();
      }
    };

    for await (const chunk of stream) {
      signal.throwIfAborted();
      let text = decoder.write(Buffer.from(chunk));
      if (discardingOversizedLine) {
        const newline = text.indexOf("\n");
        if (newline === -1) continue;
        await consumeLine("");
        text = text.slice(newline + 1);
        discardingOversizedLine = false;
      }
      lineBuffer += text;
      for (;;) {
        const newline = lineBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newline + 1);
        await consumeLine(line);
      }
      if (Buffer.byteLength(lineBuffer, "utf8") > MAX_SEARCH_LINE_BYTES) {
        lineBuffer = "";
        discardingOversizedLine = true;
      }
    }
    const final = decoder.end();
    if (final) lineBuffer += final;
    if (lineBuffer.length > 0) await consumeLine(lineBuffer.replace(/\r$/, ""));
  } finally {
    stream.destroy();
  }
}

export function globPatternToRegex(pattern: string): RegExp {
  return globToRegex(pattern, true);
}

export class NodeFallbackSearchBackend implements SearchBackend {
  readonly kind = "node-fallback" as const;

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    const root = request.roots?.[0];
    if (root === undefined || root === "" || root === ".") {
      throw new Error("NodeFallbackSearchBackend requires a resolved absolute root");
    }
    validatePattern(request.pattern);
    const limit = Math.max(0, Math.min(request.limit ?? 200, 200));
    const files = walkFiles(root, {
      signal,
      skipHidden: true,
      gitignore: !(request.ignoreGitignore ?? false),
      allowed: request.allowed,
    });

    if (request.mode === "glob") {
      const re = globToRegex(request.pattern, true);
      const matches: SearchMatch[] = [];
      let totalCount = 0;
      for await (const file of files) {
        signal.throwIfAborted();
        if (!re.test(file)) continue;
        totalCount++;
        if (matches.length < limit) matches.push({ path: file, text: file });
      }
      return { matches, truncated: totalCount > limit, totalCount };
    }

    let re: RegExp;
    try {
      re = new RegExp(request.pattern, request.caseSensitive ? "" : "i");
    } catch {
      re = new RegExp(request.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), request.caseSensitive ? "" : "i");
    }
    const matches: SearchMatch[] = [];
    const state = { totalCount: 0 };
    for await (const rel of files) {
      signal.throwIfAborted();
      request.onFileRead?.(rel);
      try {
        await searchTextFile(root, rel, re, request, signal, matches, state, limit);
      } catch (error) {
        if (signal.aborted) throw error;
        // A file can disappear or become unreadable during a scan. Preserve
        // the existing best-effort search contract for that race.
      }
    }
    return { matches, truncated: state.totalCount > limit, totalCount: state.totalCount };
  }
}
