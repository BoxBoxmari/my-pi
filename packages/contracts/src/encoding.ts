/**
 * Deterministic text encoding, BOM, and newline detection/preservation.
 * Raw bytes are read and fingerprinted BEFORE decoding (A11).
 */

export type TextEncoding = "utf-8" | "utf-8-bom" | "utf-16le-bom" | "utf-16be-bom";
export type NewlineStyle = "lf" | "crlf" | "mixed" | "none";

export const UTF8_BOM = [0xef, 0xbb, 0xbf];
export const UTF16LE_BOM = [0xff, 0xfe];
export const UTF16BE_BOM = [0xfe, 0xff];

export interface DetectedEncoding {
  encoding: TextEncoding;
  bom: boolean;
  /** Bytes length of the BOM (0 if none). */
  bomLength: number;
}

export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  const len = bytes.byteLength;
  if (len >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8-bom", bom: true, bomLength: 3 };
  }
  if (len >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be-bom", bom: true, bomLength: 2 };
  }
  if (len >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le-bom", bom: true, bomLength: 2 };
  }
  return { encoding: "utf-8", bom: false, bomLength: 0 };
}

/**
 * Detect newline style from decoded text. Conservative: report the dominant
 * style; preserve untouched bytes on mutation.
 */
export function detectNewline(text: string): NewlineStyle {
  let hasCrlf = false;
  let hasLf = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      if (i > 0 && text[i - 1] === "\r") hasCrlf = true;
      else hasLf = true;
    }
  }
  if (hasCrlf && hasLf) return "mixed";
  if (hasCrlf) return "crlf";
  if (hasLf) return "lf";
  return "none";
}

export function hasFinalNewline(text: string): boolean {
  return text.length > 0 && (text.endsWith("\n") || text.endsWith("\r"));
}

export function stripBom(bytes: Uint8Array, bomLength: number): Uint8Array {
  return bytes.subarray(bomLength);
}

/** Decode bytes to text using the detected encoding, preserving semantics. */
export function decodeText(bytes: Uint8Array, detected: DetectedEncoding): string {
  const body = stripBom(bytes, detected.bomLength);
  switch (detected.encoding) {
    case "utf-8-bom":
    case "utf-8":
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    case "utf-16le-bom":
      return new TextDecoder("utf-16le", { fatal: true }).decode(body);
    case "utf-16be-bom":
      return new TextDecoder("utf-16be", { fatal: true }).decode(body);
  }
}

/**
 * Encode text back to bytes, re-attaching the original BOM so byte fidelity is
 * preserved for the untouched portions.
 */
export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  let body: Uint8Array;
  switch (encoding) {
    case "utf-8":
    case "utf-8-bom":
      body = new TextEncoder().encode(text);
      break;
    case "utf-16le-bom":
      body = new TextEncoder().encode(text); // surrogate pairs are not valid; use utf16 fallback below
      body = encodeUtf16(text, false);
      break;
    case "utf-16be-bom":
      body = encodeUtf16(text, true);
      break;
  }
  if (encoding === "utf-8-bom") return concatBytes(new Uint8Array(UTF8_BOM), body);
  if (encoding === "utf-16le-bom") return concatBytes(new Uint8Array(UTF16LE_BOM), body);
  if (encoding === "utf-16be-bom") return concatBytes(new Uint8Array(UTF16BE_BOM), body);
  return body;
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (bigEndian) dv.setUint16(i * 2, code, false);
    else dv.setUint16(i * 2, code, true);
  }
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/** Very light heuristic: reject obvious NUL-heavy binary content for text tools. */
export function isLikelyBinary(bytes: Uint8Array): boolean {
  const sample = Math.min(bytes.byteLength, 1024);
  if (sample === 0) return false;
  let nul = 0;
  for (let i = 0; i < sample; i++) if (bytes[i] === 0) nul++;
  return nul / sample > 0.05;
}
