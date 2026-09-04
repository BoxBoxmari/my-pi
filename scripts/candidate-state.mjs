import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...options });
}

function isGeneratedEvidence(relativePath) {
  return /^evidence\/PN\d+\.json$/i.test(relativePath.replaceAll("\\", "/"));
}

export function isGeneratedArtifact(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return isGeneratedEvidence(normalized) || /^evidence\/(?:G\d+|R\d+)\.json$/i.test(normalized) || /^benchmarks\/results\/.*\.json$/i.test(normalized) || normalized === "provenance/SBOM.cdx.json" || normalized === "docs/protocol-evidence.json";
}

/** Hash the candidate source state without making generated PN evidence self-referential. */
export async function candidateStateDigest() {
  const hash = createHash("sha256");
  const tracked = git(["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((relativePath) => relativePath && !isGeneratedArtifact(relativePath))
    .sort();
  const paths = [...new Set([...tracked, ...untracked].filter((relativePath) => relativePath && !isGeneratedArtifact(relativePath)))].sort();
  for (const relativePath of paths) {
    const normalized = relativePath.replaceAll("\\", "/");
    hash.update(normalized);
    hash.update("\0");
    try {
      hash.update(await readFile(path.join(ROOT, relativePath)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      hash.update("<deleted>\0");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function candidateCommit() {
  return git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function candidateDirty() {
  const entries = git(["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.slice(3).replaceAll("\\", "/"));
  return entries.some((relativePath) => !isGeneratedArtifact(relativePath));
}
