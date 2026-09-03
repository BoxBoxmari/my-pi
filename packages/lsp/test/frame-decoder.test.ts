import { test } from "node:test";
import assert from "node:assert/strict";
import { LspFrameDecoder, LspFrameError } from "@my-pi/lsp";

function frame(body: string): Buffer {
  const bytes = Buffer.from(body, "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${bytes.byteLength}\r\n\r\n`, "ascii"),
    bytes,
  ]);
}

function decodeInChunks(input: Buffer, chunkSize: number): string[] {
  const decoder = new LspFrameDecoder();
  const bodies: string[] = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    for (const body of decoder.push(input.subarray(offset, offset + chunkSize))) {
      bodies.push(body.toString("utf8"));
    }
  }
  return bodies;
}

test("LSP framing uses UTF-8 byte length for Vietnamese, Japanese, and emoji", () => {
  for (const text of ["Xin chào Việt Nam", "こんにちは世界", "hello 🌍"])
    assert.deepEqual(decodeInChunks(frame(JSON.stringify({ text })), 1), [JSON.stringify({ text })]);
});

test("LSP framing handles every header and body split boundary", () => {
  const input = frame(JSON.stringify({ message: "tiếng Việt 🌏" }));
  for (let split = 1; split < input.length; split++) {
    const decoder = new LspFrameDecoder();
    const bodies = [
      ...decoder.push(input.subarray(0, split)),
      ...decoder.push(input.subarray(split)),
    ];
    assert.deepEqual(bodies.map((body) => body.toString("utf8")), [JSON.stringify({ message: "tiếng Việt 🌏" })]);
  }
});

test("LSP framing parses multiple frames and a partial frame followed by a frame", () => {
  const first = frame(JSON.stringify({ id: 1, result: "第一" }));
  const second = frame(JSON.stringify({ method: "publishDiagnostics", params: { text: "第二" } }));
  const decoder = new LspFrameDecoder();
  const bodies = [
    ...decoder.push(first.subarray(0, 7)),
    ...decoder.push(Buffer.concat([first.subarray(7), second])),
  ];
  assert.deepEqual(bodies.map((body) => JSON.parse(body.toString("utf8"))), [
    { id: 1, result: "第一" },
    { method: "publishDiagnostics", params: { text: "第二" } },
  ]);
});

test("LSP framing rejects malformed headers instead of silently resynchronizing", () => {
  const decoder = new LspFrameDecoder();
  assert.throws(
    () => decoder.push(Buffer.from("Content-Type: application/json\r\n\r\n{}", "ascii")),
    (error: unknown) => error instanceof LspFrameError && /Content-Length/.test(error.message),
  );
  assert.throws(
    () => decoder.push(Buffer.from("Content-Length: nope\r\n\r\n{}", "ascii")),
    (error: unknown) => error instanceof LspFrameError && /Content-Length/.test(error.message),
  );
});

test("LSP framing rejects oversized frames before buffering the body", () => {
  const decoder = new LspFrameDecoder(4);
  assert.throws(
    () => decoder.push(Buffer.from("Content-Length: 5\r\n\r\n", "ascii")),
    (error: unknown) => error instanceof LspFrameError && /exceeds 4 bytes/.test(error.message),
  );
});
