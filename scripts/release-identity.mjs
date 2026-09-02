/**
 * Shared release identity helpers.
 *
 * Release evidence must identify the exact commit being qualified. This
 * module centralizes the precedence and normalization rules used by the
 * release scripts so they cannot drift apart.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
export const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function gitCommitAt(cwd) {
  return execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Normalize a commit identifier to a lowercase full SHA.
 *
 * Full SHAs are already self-contained identifiers. Short SHAs are accepted
 * only when Git can resolve them to an unambiguous commit in the candidate's
 * repository; unrelated or malformed prefixes fail closed.
 */
export function normalizeCommit(commit, { cwd = process.cwd() } = {}) {
  if (typeof commit !== "string") {
    throw new Error("commit identifier must be a string");
  }

  const normalized = commit.trim().toLowerCase();
  if (!COMMIT_PATTERN.test(normalized)) {
    throw new Error(`malformed commit identifier: ${commit}`);
  }

  if (FULL_COMMIT_PATTERN.test(normalized)) {
    return normalized;
  }

  try {
    const resolved = execFileSync("git", ["rev-parse", "--verify", `${normalized}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim().toLowerCase();
    if (!FULL_COMMIT_PATTERN.test(resolved)) {
      throw new Error("Git returned a non-full commit identifier");
    }
    return resolved;
  } catch {
    throw new Error(`unable to resolve commit identifier "${commit}" against Git history`);
  }
}

/**
 * Resolve the candidate commit using the documented release precedence:
 * RELEASE_COMMIT, GITHUB_SHA, then the local repository HEAD.
 */
export function getReleaseIdentity({ env = process.env, cwd = process.cwd() } = {}) {
  for (const name of ["RELEASE_COMMIT", "GITHUB_SHA"]) {
    if (typeof env[name] === "string" && env[name].trim() !== "") {
      return { commit: normalizeCommit(env[name], { cwd }), source: name };
    }
  }

  try {
    return { commit: normalizeCommit(gitCommitAt(cwd), { cwd }), source: "git HEAD" };
  } catch {
    throw new Error("unable to determine canonical release commit from RELEASE_COMMIT, GITHUB_SHA, or git HEAD");
  }
}

export function resolveReleaseCommit(options) {
  return getReleaseIdentity(options).commit;
}
