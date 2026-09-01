export type ReleaseRole = "blocking" | "monitoring";

export interface HostProfile {
  id: string;
  releaseRole: ReleaseRole;
  preferredTransport: "stdio";
  configDialect: "claude-code" | "opencode" | "cursor" | "antigravity" | "copilot-vscode" | "copilot-cli";
  observedMcpEra?: string;
  knownQuirks: string[];
}

export const REQUIRED_PROFILES: HostProfile[] = [
  { id: "claude-code-local", releaseRole: "blocking", preferredTransport: "stdio", configDialect: "claude-code", knownQuirks: [] },
  { id: "opencode-current-local", releaseRole: "blocking", preferredTransport: "stdio", configDialect: "opencode", knownQuirks: [] },
  { id: "opencode-v2-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "opencode", knownQuirks: ["config shape may move"] },
  { id: "cursor-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "cursor", knownQuirks: [] },
  { id: "antigravity-ide-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "antigravity", knownQuirks: ["workspace config under .agents/mcp_config.json"] },
  { id: "antigravity-cli-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "antigravity", knownQuirks: [] },
  { id: "copilot-vscode-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "copilot-vscode", knownQuirks: [] },
  { id: "copilot-cli-local", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "copilot-cli", knownQuirks: [] },
  { id: "copilot-cloud-local-in-agent", releaseRole: "monitoring", preferredTransport: "stdio", configDialect: "copilot-vscode", knownQuirks: ["local-in-agent profile"] },
];
