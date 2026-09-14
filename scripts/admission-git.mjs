import { execFileSync } from "node:child_process";
import { canonicalizeAdmissionSubject } from "../packages/change-runtime/dist/index.js";

const FULL_SHA = /^[0-9a-f]{40,64}$/i;

export function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function requireCommit(value, name) {
  if (!FULL_SHA.test(value)) throw new Error(`${name} must be a full commit SHA`);
  return value.toLowerCase();
}

function treeEntry(root, head, path) {
  const output = execFileSync("git", ["ls-tree", "-z", head, "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const record = output.split("\0").find(Boolean);
  if (!record) return { mode: "000000", absent: true };
  const match = /^(\d{6})\s+\S+\s+([0-9a-f]{40,64})\t/.exec(record);
  if (!match) throw new Error(`unable to parse Git tree entry for ${path}`);
  return { mode: match[1], blobOid: match[2] };
}

export function gitChangeSet(root, base, head) {
  const baseCommit = requireCommit(base, "base");
  const headCommit = requireCommit(head, "head");
  const tokens = execFileSync("git", ["diff", "--name-status", "-z", "-M", baseCommit, headCommit], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    const statusCode = statusToken[0];
    const previousPath = statusCode === "R" || statusCode === "C" ? tokens[index++] : undefined;
    const currentPath = tokens[index++];
    if (!currentPath) throw new Error("Git returned an incomplete name-status record");
    const status = statusCode === "A" ? "added" : statusCode === "M" ? "modified" : statusCode === "D" ? "deleted" : statusCode === "R" ? "renamed" : statusCode === "C" ? "copied" : statusCode === "T" ? "type_changed" : undefined;
    if (status === undefined) throw new Error(`unsupported Git change status: ${statusToken}`);
    const tree = treeEntry(root, headCommit, currentPath);
    changes.push({ status, path: currentPath, ...(status === "renamed" ? { previousPath } : {}), ...tree });
  }
  return { baseCommit, headCommit, changes };
}

export function repositoryIdentity(root) {
  try {
    return git(root, ["config", "--get", "remote.origin.url"]);
  } catch {
    return git(root, ["rev-parse", "--show-toplevel"]);
  }
}

export function assertCleanCandidate(root) {
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.length > 0) throw new Error("candidate worktree must be clean before admission subject verification");
}

export function subjectFromGit(root, { repository, base, head }) {
  const changeSet = gitChangeSet(root, base, head);
  return canonicalizeAdmissionSubject({ repositoryIdentity: repository ?? repositoryIdentity(root), ...changeSet });
}
