import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  detectEncoding,
  isLikelyBinary,
  type DetectedEncoding,
  type NewlineStyle,
  type TextEncoding,
} from "@my-pi/contracts";

export const DEFAULT_FS_READ_BYTES = 48 * 1024;
export const MAX_FS_READ_BYTES = 1024 * 1024;
export const MAX_FS_WRITE_BYTES = 8 * 1024 * 1024;

const STREAM_CHUNK_BYTES = 64 * 1024;
const BINARY_SAMPLE_BYTES = 1024;

export interface BoundedFileRead {
  size: number;
  digest: string;
  encoding: TextEncoding;
  bom: boolean;
  newline: NewlineStyle;
  finalNewline: boolean;
  content: string;
  contentBytes: number;
  contentOffset: number;
  nextOffset?: number;
}

export class BoundedReadError extends Error {
  constructor(readonly kind: "binary" | "encoding", message: string) {
    super(message);
    this.name = "BoundedReadError";
  }
}

class TextMetadataTracker {
  private previous = "";
  private last = "";
  private sawCrlf = false;
  private sawLf = false;

  update(text: string): void {
    for (const ch of text) {
      if (ch === "\n") {
        if (this.previous === "\r") this.sawCrlf = true;
        else this.sawLf = true;
      }
      this.previous = ch;
      this.last = ch;
    }
  }

  finish(): { newline: NewlineStyle; finalNewline: boolean } {
    const newline: NewlineStyle = this.sawCrlf && this.sawLf
      ? "mixed"
      : this.sawCrlf
        ? "crlf"
        : this.sawLf
          ? "lf"
          : "none";
    return {
      newline,
      finalNewline: this.last === "\n" || this.last === "\r",
    };
  }
}

function decoderName(encoding: TextEncoding): "utf-8" | "utf-16le" | "utf-16be" {
  if (encoding === "utf-16le-bom") return "utf-16le";
  if (encoding === "utf-16be-bom") return "utf-16be";
  return "utf-8";
}

function utf8Width(byte: number): number {
  if (byte <= 0x7f) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

function isUtf8Continuation(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function byteAt(candidate: Buffer, candidateStart: number, absolute: number): number | undefined {
  const index = absolute - candidateStart;
  return index >= 0 && index < candidate.length ? candidate[index] : undefined;
}

function safeUtf8Range(
  candidate: Buffer,
  candidateStart: number,
  offset: number,
  endLimit: number,
): { start: number; end: number } {
  let start = offset;
  while (start > candidateStart) {
    const byte = byteAt(candidate, candidateStart, start);
    if (byte === undefined || !isUtf8Continuation(byte)) break;
    start--;
  }

  let end = Math.min(endLimit, start + (endLimit - offset));
  let cursor = start;
  while (cursor < end) {
    const first = byteAt(candidate, candidateStart, cursor);
    if (first === undefined) break;
    const width = utf8Width(first);
    if (width === 0) {
      cursor++;
      continue;
    }
    if (cursor + width > end) {
      end = cursor;
      break;
    }
    let valid = true;
    for (let i = 1; i < width; i++) {
      const next = byteAt(candidate, candidateStart, cursor + i);
      if (next === undefined || !isUtf8Continuation(next)) {
        valid = false;
        break;
      }
    }
    cursor += valid ? width : 1;
  }
  return { start, end };
}

function readUtf16CodeUnit(candidate: Buffer, candidateStart: number, absolute: number, bigEndian: boolean): number | undefined {
  const first = byteAt(candidate, candidateStart, absolute);
  const second = byteAt(candidate, candidateStart, absolute + 1);
  if (first === undefined || second === undefined) return undefined;
  return bigEndian ? (first << 8) | second : first | (second << 8);
}

function safeUtf16Range(
  candidate: Buffer,
  candidateStart: number,
  offset: number,
  endLimit: number,
  bomLength: number,
  bigEndian: boolean,
): { start: number; end: number } {
  let start = Math.max(offset, bomLength);
  if ((start - bomLength) % 2 !== 0) start--;

  let end = Math.min(Math.max(start, endLimit), start + (endLimit - offset));
  if ((end - bomLength) % 2 !== 0) end--;
  if (end < start) end = start;

  let cursor = start;
  while (cursor + 1 < end) {
    const code = readUtf16CodeUnit(candidate, candidateStart, cursor, bigEndian);
    if (code === undefined) break;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = readUtf16CodeUnit(candidate, candidateStart, cursor + 2, bigEndian);
      if (next === undefined || cursor + 3 >= end) {
        end = cursor;
        break;
      }
    }
    cursor += 2;
  }
  return { start, end };
}

function decodeWindow(bytes: Buffer, detected: DetectedEncoding, contentOffset: number): string {
  let body = bytes;
  if (contentOffset === 0 && detected.bom) body = bytes.subarray(detected.bomLength);
  return new TextDecoder(decoderName(detected.encoding), { fatal: true }).decode(body);
}

function appendOverlap(parts: Buffer[], piece: Buffer, pieceOffset: number, start: number, end: number): void {
  const overlapStart = Math.max(pieceOffset, start);
  const overlapEnd = Math.min(pieceOffset + piece.length, end);
  if (overlapStart < overlapEnd) {
    parts.push(Buffer.from(piece.subarray(overlapStart - pieceOffset, overlapEnd - pieceOffset)));
  }
}

async function readPrefix(handle: FileHandle): Promise<Buffer> {
  const prefix = Buffer.alloc(3);
  const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
  return prefix.subarray(0, bytesRead);
}

/**
 * Read a byte window while hashing and scanning metadata incrementally.
 * Only the requested window plus a few alignment bytes are retained.
 */
export async function readBoundedFile(filePath: string, offset: number, maxBytes: number): Promise<BoundedFileRead> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("offset must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_FS_READ_BYTES) {
    throw new RangeError(`max_bytes must be between 1 and ${MAX_FS_READ_BYTES}`);
  }

  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const sizeHint = Number(stat.size);
    const prefix = await readPrefix(handle);
    const detected = detectEncoding(prefix);
    const requestedOffset = Math.min(offset, sizeHint);
    const endLimit = Math.min(sizeHint, requestedOffset + maxBytes);
    const candidateStart = Math.max(0, requestedOffset - 4);
    const candidateEnd = Math.min(sizeHint, endLimit + 4);
    const candidateParts: Buffer[] = [];
    const hash = createHash("sha256");
    const metadata = new TextMetadataTracker();
    const decoder = new TextDecoder(decoderName(detected.encoding), { fatal: true });
    const sampleParts: Buffer[] = [];
    const chunk = Buffer.alloc(STREAM_CHUNK_BYTES);
    let position = 0;
    let sampleBytes = 0;
    let binary = false;

    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      const piece = chunk.subarray(0, bytesRead);
      hash.update(piece);
      appendOverlap(candidateParts, piece, position, candidateStart, candidateEnd);

      if (sampleBytes < BINARY_SAMPLE_BYTES) {
        const take = Math.min(BINARY_SAMPLE_BYTES - sampleBytes, piece.length);
        sampleParts.push(Buffer.from(piece.subarray(0, take)));
        sampleBytes += take;
        if (sampleBytes >= BINARY_SAMPLE_BYTES) {
          binary = isLikelyBinary(Buffer.concat(sampleParts));
          if (binary) throw new BoundedReadError("binary", "binary file");
        }
      }

      if (!binary) {
        const body = position === 0 ? piece.subarray(detected.bomLength) : piece;
        try {
          metadata.update(decoder.decode(body, { stream: true }));
        } catch {
          throw new BoundedReadError("encoding", "unsupported text encoding");
        }
      }
      position += bytesRead;
    }

    const actualSize = position;
    if (!binary) {
      try {
        metadata.update(decoder.decode());
      } catch {
        throw new BoundedReadError("encoding", "unsupported text encoding");
      }
    }
    if (!binary && sampleBytes < BINARY_SAMPLE_BYTES) binary = isLikelyBinary(Buffer.concat(sampleParts));
    if (binary) throw new BoundedReadError("binary", "binary file");

    const candidate = candidateParts.length === 0 ? Buffer.alloc(0) : Buffer.concat(candidateParts);
    const effectiveEndLimit = Math.min(actualSize, requestedOffset + maxBytes);
    const range = detected.encoding === "utf-16le-bom" || detected.encoding === "utf-16be-bom"
      ? safeUtf16Range(candidate, candidateStart, requestedOffset, effectiveEndLimit, detected.bomLength, detected.encoding === "utf-16be-bom")
      : safeUtf8Range(candidate, candidateStart, requestedOffset, effectiveEndLimit);
    const content = candidate.subarray(range.start - candidateStart, range.end - candidateStart);
    let contentText: string;
    try {
      contentText = decodeWindow(content, detected, range.start);
    } catch {
      throw new BoundedReadError("encoding", "unsupported text encoding");
    }
    const stats = metadata.finish();
    const nextOffset = range.end < actualSize
      ? Math.min(actualSize, Math.max(requestedOffset + 1, range.end))
      : undefined;

    return {
      size: actualSize,
      digest: hash.digest("hex"),
      encoding: detected.encoding,
      bom: detected.bom,
      newline: stats.newline,
      finalNewline: stats.finalNewline,
      content: contentText,
      contentBytes: content.byteLength,
      contentOffset: range.start,
      nextOffset,
    };
  } finally {
    await handle.close();
  }
}
