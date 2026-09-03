import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_PROFILES, renderProfile } from "@my-pi/host-profiles";

test("REQUIRED_PROFILES: two blocking, seven monitoring", () => {
  assert.equal(REQUIRED_PROFILES.filter((p) => p.releaseRole === "blocking").length, 2);
  assert.equal(REQUIRED_PROFILES.filter((p) => p.releaseRole === "monitoring").length, 7);
  const roles = new Set(REQUIRED_PROFILES.map((p) => p.id));
  assert.ok(roles.has("claude-code-local"));
  assert.ok(roles.has("opencode-current-local"));
  assert.ok(roles.has("cursor-local"));
});

test("renderProfile: opencode and cursor JSON shapes (my-pi primary + ccr alias)", () => {
  const opencode = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "opencode-current-local")!, {
    command: "my-pi-mcp",
    workspace: "${workspaceFolder}",
  });
  assert.equal(opencode.type, "json");
  const j = (opencode as { json: Record<string, unknown> }).json;
  assert.ok((j["mcp"] as Record<string, unknown>)["my-pi"]);
  assert.ok((j["mcp"] as Record<string, unknown>)["ccr"]);
  assert.match(JSON.stringify(j), /security-profile.*read-only/);

  const cursor = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "cursor-local")!, {
    command: "my-pi-mcp",
    workspace: "${workspaceFolder}",
  });
  const cj = (cursor as { json: Record<string, unknown> }).json;
  assert.ok((cj["mcpServers"] as Record<string, unknown>)["my-pi"]);
  assert.ok((cj["mcpServers"] as Record<string, unknown>)["ccr"]);
  assert.match(JSON.stringify(cj), /security-profile.*read-only/);
});

test("renderProfile: claude-code renders a CLI command, not JSON", () => {
  const claude = renderProfile(REQUIRED_PROFILES.find((p) => p.id === "claude-code-local")!, {
    command: "my-pi-mcp",
    workspace: ".",
  });
  assert.equal(claude.type, "cli");
  assert.match(claude.command, /claude mcp add my-pi/);
  assert.match(claude.command, /claude mcp add ccr/);
  assert.match(claude.command, /--workspace \./);
});
