/**
 * Byte-correct decoder for the LSP Content-Length framing protocol.
 *
 * LSP measures Content-Length in UTF-8 bytes, not JavaScript characters. This
 * decoder keeps transport data as bytes until a complete body is isolated and
 * fails closed on malformed or oversized frames.
 */

const HEADER_TERMINATOR = Buffer.from("\r\n\r\n", "ascii");
const MAX_HEADER_BYTES = 64 * 1024;
export const DEFAULT_MAX_LSP_FRAME_BYTES = 16 * 1024 * 1024;

export class LspFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LspFrameError";
  }
}

function parseContentLength(header: string): number {
  let length: number | undefined;
  for (const line of header.split("\r\n")) {
    const match = /^Content-Length:\s*(\d+)\s*$/i.exec(line);
    if (!match) continue;
    if (length !== undefined) throw new LspFrameError("duplicate Content-Length header");
    const parsed = Number(match[1]);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new LspFrameError("invalid Content-Length header");
    }
    length = parsed;
  }
  if (length === undefined) throw new LspFrameError("missing Content-Length header");
  return length;
}

export class LspFrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_LSP_FRAME_BYTES) {}

  get bufferedBytes(): number {
    return this.buffer.byteLength;
  }

  push(chunk: Uint8Array): Buffer[] {
    if (chunk.byteLength > 0) {
      this.buffer = this.buffer.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.buffer, Buffer.from(chunk)]);
    }

    const frames: Buffer[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR);
      if (headerEnd === -1) {
        if (this.buffer.byteLength > MAX_HEADER_BYTES) {
          throw new LspFrameError("LSP header exceeds the maximum size");
        }
        break;
      }

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = parseContentLength(header);
      if (contentLength > this.maxFrameBytes) {
        throw new LspFrameError(`LSP frame exceeds ${this.maxFrameBytes} bytes`);
      }

      const bodyStart = headerEnd + HEADER_TERMINATOR.byteLength;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < bodyEnd) break;

      frames.push(Buffer.from(this.buffer.subarray(bodyStart, bodyEnd)));
      this.buffer = this.buffer.subarray(bodyEnd);
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
