/**
 * Cross-platform path normalization and workspace containment.
 * Windows: drive letters, UNC, junctions, case-insensitive collisions.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { err } from "@ccr/contracts";

const isWindows = process.platform === "win32";

export interface ResolvedPath {
  absolute: string;
  relPosix: string;
  root: string;
  exists: boolean;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/").split("\\").join("/");
}

export function fromPosix(p: string): string {
  return isWindows ? p.split("/").join(path.sep) : p;
}

export function samePath(a: string, b: string): boolean {
  if (isWindows) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function canonicalizeWithinRoots(
  roots: string[],
  input: string,
  baseDir: string,
): Promise<ResolvedPath> {
  const abs = path.resolve(baseDir, input);
  let real = abs;
  let exists = true;
  try {
    real = await fs.realpath(abs);
  } catch (e) {
    exists = false;
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw e;
    let ancestor = abs;
    let depth = 0;
    while (!(await existsSync(ancestor)) && depth < 64) {
      ancestor = path.dirname(ancestor);
      depth++;
    }
    try {
      const realAncestor = await fs.realpath(ancestor);
      real = path.join(realAncestor, path.relative(ancestor, abs));
    } catch {
      real = abs;
    }
  }
  const root = roots.find((r) => isWithin(r, real) || samePath(r, real));
  if (root === undefined) {
    throw err.pathOutsideWorkspace(`path escapes workspace containment: ${input}`);
  }
  return {
    absolute: real,
    relPosix: toPosix(path.relative(root, real)),
    root,
    exists,
  };
}

async function existsSync(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
