/**
 * Minimal single-file Hashline adaptation (v1.1 §18).
 */
import { err } from "@my-pi/contracts";

export interface Hunk {
  old: string;
  new: string;
}

export interface Patch {
  hunks: Hunk[];
}

export const MAX_PATCH_HUNKS = 1000;
export const MAX_PATCH_TEXT_BYTES = 1024 * 1024;

export function parsePatch(input: unknown): Patch {
  if (typeof input !== "object" || input === null) {
    throw err.parseFailed("patch must be an object");
  }
  const rec = input as Record<string, unknown>;
  const hunksRaw = rec["hunks"];
  if (!Array.isArray(hunksRaw)) throw err.parseFailed("patch.hunks must be an array");
  if (hunksRaw.length > MAX_PATCH_HUNKS) throw err.outputLimit(`patch contains more than ${MAX_PATCH_HUNKS} hunks`);
  const hunks: Hunk[] = hunksRaw.map((h, i) => {
    if (typeof h !== "object" || h === null) throw err.parseFailed(`hunk[${i}] must be an object`);
    const r = h as Record<string, unknown>;
    if (typeof r["old"] !== "string") throw err.parseFailed(`hunk[${i}].old must be a string`);
    if (typeof r["new"] !== "string") throw err.parseFailed(`hunk[${i}].new must be a string`);
    if (Buffer.byteLength(r["old"], "utf8") > MAX_PATCH_TEXT_BYTES || Buffer.byteLength(r["new"], "utf8") > MAX_PATCH_TEXT_BYTES) {
      throw err.outputLimit(`hunk[${i}] exceeds ${MAX_PATCH_TEXT_BYTES} bytes`);
    }
    return { old: r["old"], new: r["new"] };
  });
  return { hunks };
}

export function applyHunks(text: string, hunks: Hunk[]): string {
  let out = text;
  for (const hunk of hunks) {
    if (hunk.old.length === 0) {
      throw err.parseFailed("hunk.old must be non-empty");
    }
    let count = 0;
    let idx = -1;
    let from = 0;
    for (;;) {
      const found = out.indexOf(hunk.old, from);
      if (found === -1) break;
      count++;
      if (idx === -1) idx = found;
      from = found + hunk.old.length;
      if (count > 1) break;
    }
    if (count === 0) throw err.parseFailed("hunk anchor not found in current file content");
    if (count > 1) throw err.ambiguousAnchor("hunk anchor is ambiguous (matches multiple times)");
    out = out.slice(0, idx) + hunk.new + out.slice(idx! + hunk.old.length);
  }
  return out;
}
