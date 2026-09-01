import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSha256,
  fingerprintBytes,
  shortAnchor,
  fingerprintsEqual,
  detectEncoding,
  detectNewline,
  hasFinalNewline,
  decodeText,
  encodeText,
  isLikelyBinary,
  CcrError,
  nodeErrorToCode,
  createWorkspaceId,
} from "@ccr/contracts";

test("fingerprintBytes produces stable sha256 + size", () => {
  const a = fingerprintBytes(new TextEncoder().encode("hello"));
  const b = fingerprintBytes(new TextEncoder().encode("hello"));
  const c = fingerprintBytes(new TextEncoder().encode("hello!"));
  assert.equal(a.digest, computeSha256(new TextEncoder().encode("hello")));
  assert.equal(a.digest, b.digest);
  assert.equal(a.size, 5);
  assert.notEqual(a.digest, c.digest);
  assert.ok(fingerprintsEqual(a, b));
  assert.ok(!fingerprintsEqual(a, c));
  assert.equal(shortAnchor(a.digest).length, 12);
  assert.equal(shortAnchor(a.digest), a.digest.slice(0, 12).toUpperCase());
});

test("detectEncoding handles BOM variants", () => {
  const utf8bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
  const utf16le = new Uint8Array([0xff, 0xfe, 0x61, 0x00]);
  const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x61]);
  const plain = new Uint8Array([0x61]);
  assert.equal(detectEncoding(utf8bom).encoding, "utf-8-bom");
  assert.equal(detectEncoding(utf16le).encoding, "utf-16le-bom");
  assert.equal(detectEncoding(utf16be).encoding, "utf-16be-bom");
  assert.equal(detectEncoding(plain).encoding, "utf-8");
  assert.equal(detectEncoding(plain).bom, false);
});

test("decode/encode round-trips preserve BOM and content", () => {
  for (const enc of ["utf-8", "utf-8-bom", "utf-16le-bom", "utf-16be-bom"] as const) {
    const bytes = encodeText("hello world", enc);
    const detected = detectEncoding(bytes);
    const text = decodeText(bytes, detected);
    assert.equal(text, "hello world");
    const re = encodeText(text, enc);
    assert.deepEqual(re, bytes);
  }
});

test("detectNewline and final newline", () => {
  assert.equal(detectNewline("a\nb\n"), "lf");
  assert.equal(detectNewline("a\r\nb\r\n"), "crlf");
  assert.equal(detectNewline("a\r\nb\n"), "mixed");
  assert.equal(detectNewline("abc"), "none");
  assert.equal(hasFinalNewline("a\n"), true);
  assert.equal(hasFinalNewline("a"), false);
});

test("isLikelyBinary rejects NUL-heavy content", () => {
  const binary = new Uint8Array(100);
  binary.fill(0);
  assert.equal(isLikelyBinary(binary), true);
  assert.equal(isLikelyBinary(new TextEncoder().encode("plain text")), false);
});

test("CcrError shape and nodeErrorToCode", () => {
  const e = new CcrError({ code: "ERR_STALE_RESOURCE", message: "stale" });
  assert.equal(e.toShape().schemaVersion, "1");
  assert.equal(nodeErrorToCode("ENOENT"), "ERR_PATH_NOT_FOUND");
  assert.equal(nodeErrorToCode("EBUSY"), "ERR_FILE_BUSY");
  assert.equal(nodeErrorToCode("EACCES", "/x/.env"), "ERR_SECRET_PATH_DENIED");
  assert.equal(nodeErrorToCode("BOGUS"), "ERR_NATIVE_FAILURE");
});

test("ids are distinct", () => {
  assert.notEqual(createWorkspaceId(), createWorkspaceId());
});
