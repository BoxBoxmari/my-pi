import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_PROFILES, renderProfile } from "@ccr/host-profiles";

test("REQUIRED_PROFILES: two blocking, seven monitoring", () => {
  assert.equal(REQUIRED_PROFILES.filter((p) => p.releaseRole === "blocking").length, 2);
  assert.equal(REQUIRED_PROFILES.filter((p) => p.releaseRole === "monitoring").length, 7);
  const roles = new Set(REQUIRED_PROFILES.map((p) => p.id));
  assert.ok(roles.has("claude-code-local"));
  assert.ok(roles.has("opencode-current-local"));
  assert.ok(roles.has("cursor-local"));
});

test("renderProfile: opencode and cursor JSON shapes", () => {
  const opencode = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "opencode-current-local")!, {
    command: "ccr-mcp",
  });
  assert.equal(opencode.type, "json");
  const j = (opencode as { json: Record<string, unknown> }).json;
  assert.ok((j["mcp"] as Record<string, unknown>)["ccr"]);

  const cursor = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "cursor-local")!, {
    command: "ccr-mcp",
  });
  const cj = (cursor as { json: Record<string, unknown> }).json;
  assert.ok((cj["mcpServers"] as Record<string, unknown>)["ccr"]);
});

test("renderProfile: claude-code renders a CLI command, not JSON", () => {
  const claude = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "claude-code-local")!, {
    command: "ccr-mcp",
    workspace: ".",
  });
  assert.equal(claude.type, "cli");
  assert.match(claude.command, /claude mcp add ccr/);
  assert.match(claude.command, /--workspace \./);
});
