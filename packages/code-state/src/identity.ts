import { createHash } from "node:crypto";
import path from "node:path";
import type { CodeEntityId } from "@my-pi/contracts";

export function stableEntityId(stableKey: string): CodeEntityId {
  const digest = createHash("sha256").update(`my-pi-code-entity:${stableKey}`, "utf8").digest("hex").slice(0, 12);
  return `entity_${digest}` as CodeEntityId;
}

export function relativePosix(root: string, filePath: string): string {
  return path.relative(root, path.resolve(filePath)).replaceAll("\\", "/");
}

export function fileStableKey(repositoryIdentity: string, relativePath: string): string {
  return `${repositoryIdentity}|file|${relativePath}`;
}

export function symbolStableKey(repositoryIdentity: string, relativePath: string, kind: string, name: string, line: number): string {
  return `${repositoryIdentity}|symbol|${relativePath}|${kind}|${name}|${line}`;
}

export function moduleStableKey(repositoryIdentity: string, relativePath: string, importText: string): string {
  return `${repositoryIdentity}|module|${relativePath}|${importText}`;
}
