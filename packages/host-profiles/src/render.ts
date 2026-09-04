import type { HostProfile } from "./profile.js";

export interface RenderOptions {
  command: string;
  args?: string[];
  workspace?: string;
}

export type RenderedConfig =
  | { type: "json"; json: unknown; pretty: string }
  | { type: "cli"; command: string };

function json(pretty: string, json: unknown): RenderedConfig {
  return { type: "json", json, pretty };
}

function mcpEntry(opts: RenderOptions, args: string[]) {
  return { type: "local", command: [opts.command, ...args] };
}

/**
 * Emit BOTH keys: `my-pi` (primary) and `ccr` (deprecated alias, kept for
 * 1 major so hosts configured with the old key keep resolving the server).
 */
function dualMcpServers(opts: RenderOptions, args: string[], entry: unknown): Record<string, unknown> {
  return {
    "my-pi": entry,
    ccr: entry,
    _comment: "ccr is a deprecated alias of my-pi (kept 1 major); prefer my-pi",
    ...(opts as { __unused?: never }),
  };
}

export function renderProfile(profile: HostProfile, opts: RenderOptions): RenderedConfig {
  const args = [...(opts.args ?? ["--transport", "stdio", "--security-profile", "read-only"])];
  if (profile.coordination) args.push("--coordination");
  if (opts.workspace !== undefined) args.push("--workspace", opts.workspace);

  switch (profile.configDialect) {
    case "claude-code":
      return {
        type: "cli",
        // Primary key my-pi; ccr alias registered as a second command.
        command: [
          `claude mcp add my-pi -- ${opts.command} ${args.join(" ")}`.trim(),
          `claude mcp add ccr -- ${opts.command} ${args.join(" ")}`.trim(),
        ].join("\n"),
      };
    case "opencode": {
      const entry = mcpEntry(opts, args);
      const j = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          "my-pi": entry,
          ccr: entry,
        },
      };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "cursor": {
      const entry = { type: "stdio", command: opts.command, args };
      const j = { mcpServers: dualMcpServers(opts, args, entry) };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "antigravity": {
      const entry = { command: opts.command, args };
      const j = { mcpServers: dualMcpServers(opts, args, entry) };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "copilot-vscode": {
      const entry = { type: "stdio", command: opts.command, args };
      const j = { servers: dualMcpServers(opts, args, entry) };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "copilot-cli": {
      const entry = { type: "stdio", command: opts.command, args, tools: ["*"] };
      const j = { mcpServers: dualMcpServers(opts, args, entry) };
      return json(JSON.stringify(j, null, 2), j);
    }
  }
}
