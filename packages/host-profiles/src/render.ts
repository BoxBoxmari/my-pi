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

export function renderProfile(profile: HostProfile, opts: RenderOptions): RenderedConfig {
  const args = [...(opts.args ?? ["--transport", "stdio"])];
  if (opts.workspace !== undefined) args.push("--workspace", opts.workspace);

  switch (profile.configDialect) {
    case "claude-code":
      return {
        type: "cli",
        command: `claude mcp add ccr -- ${opts.command} ${args.join(" ")}`.trim(),
      };
    case "opencode": {
      const j = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          ccr: { type: "local", command: [opts.command, ...args] },
        },
      };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "cursor": {
      const j = { mcpServers: { ccr: { type: "stdio", command: opts.command, args } } };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "antigravity": {
      const j = { mcpServers: { ccr: { command: opts.command, args } } };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "copilot-vscode": {
      const j = { servers: { ccr: { type: "stdio", command: opts.command, args } } };
      return json(JSON.stringify(j, null, 2), j);
    }
    case "copilot-cli": {
      const j = { mcpServers: { ccr: { type: "stdio", command: opts.command, args, tools: ["*"] } } };
      return json(JSON.stringify(j, null, 2), j);
    }
  }
}
