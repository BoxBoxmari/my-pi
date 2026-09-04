import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFrame, encodeFrame, parseRequest, IPC_PROTOCOL_VERSION } from "@my-pi/coordination-client";

test("IPC protocol round-trips bounded JSON and BigInt markers", () => {
  const frame = encodeFrame({ sequence: 12n, value: "ok" });
  assert.equal(frame.toString("utf8").endsWith("\n"), true);
  assert.deepEqual(decodeFrame(frame.subarray(0, -1)), { sequence: 12n, value: "ok" });
});

test("IPC request parser validates the versioned request envelope", () => {
  assert.deepEqual(parseRequest({
    protocolVersion: IPC_PROTOCOL_VERSION,
    requestId: "req-1",
    method: "health",
    params: {},
    clientInfo: { name: "test", version: "1" },
  }), {
    protocolVersion: IPC_PROTOCOL_VERSION,
    requestId: "req-1",
    method: "health",
    params: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.throws(() => parseRequest({ method: "health" }), /protocolVersion/);
  assert.throws(() => decodeFrame("not-json"), /invalid IPC JSON/);
});

test("IPC frame size is bounded before a write", () => {
  assert.throws(() => encodeFrame({ value: "x".repeat(300_000) }), RangeError);
});
