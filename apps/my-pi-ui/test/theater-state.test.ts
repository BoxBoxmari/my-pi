import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_THEATER_UI_STATE,
  clampReplayIndex,
  eventTypeOf,
  isStructuralEvent,
  reduce,
  replayDisplayText,
  streamStatusText,
} from "../dist/theater-state.js";

test("reduce routes every interaction through explicit actions", () => {
  let ui = { ...INITIAL_THEATER_UI_STATE };
  ui = reduce(ui, { type: "select-node", nodeId: "n1" });
  assert.equal(ui.selectedNodeId, "n1");
  ui = reduce(ui, { type: "deselect" });
  assert.equal(ui.selectedNodeId, null);
  ui = reduce(ui, { type: "enter-replay" });
  assert.equal(ui.mode, "replay");
  assert.equal(ui.replayIndex, 0);
  ui = reduce(ui, { type: "replay-seek", index: 4, eventCount: 10 });
  assert.equal(ui.replayIndex, 4);
  ui = reduce(ui, { type: "replay-advance", eventCount: 10 });
  assert.equal(ui.replayIndex, 5);
  ui = reduce(ui, { type: "exit-replay" });
  assert.equal(ui.mode, "live");
  ui = reduce(ui, { type: "renderer-failed" });
  assert.equal(ui.renderer, "2d");
  ui = reduce(ui, { type: "renderer-restored" });
  assert.equal(ui.renderer, "3d");
  ui = reduce(ui, { type: "stream-state", stream: "reconnecting" });
  assert.equal(ui.stream, "reconnecting");
});

test("clampReplayIndex bounds every seek/advance", () => {
  assert.equal(clampReplayIndex(3, 10), 3);
  assert.equal(clampReplayIndex(99, 10), 9);
  assert.equal(clampReplayIndex(-2, 10), 0);
  assert.equal(clampReplayIndex(0, 0), 0);
  assert.equal(clampReplayIndex(Number.NaN, 10), 0);
  assert.equal(clampReplayIndex(2.7, 10), 2);
});

test("structural events are detected independent of payload shape", () => {
  assert.equal(isStructuralEvent("AgentJoined"), true);
  assert.equal(isStructuralEvent("Heartbeat"), false);
  assert.equal(eventTypeOf({ eventType: "Blocked" } as never), "Blocked");
  assert.equal(eventTypeOf({ type: "Claimed" } as never), "Claimed");
  assert.equal(eventTypeOf({} as never), "");
});

test("selectors derive display text without DOM", () => {
  assert.equal(replayDisplayText(0, 5), "Event 1 of 5");
  assert.equal(streamStatusText({ stream: "live", isMcp: false, hasApiBase: true, isReplay: false }), "● live");
  assert.equal(streamStatusText({ stream: "live", isMcp: false, hasApiBase: true, isReplay: true }), null);
  assert.equal(streamStatusText({ stream: "live", isMcp: true, hasApiBase: true, isReplay: false }), null);
  assert.equal(streamStatusText({ stream: "offline", isMcp: false, hasApiBase: true, isReplay: false }), "● offline");
});
