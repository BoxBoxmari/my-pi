/**
 * LspRegistry key: workspace_id + language/server identity + config hash.
 */
export type LspRegistryKey = string;
export function registryKey(workspaceId: string, language: string, configHash: string): LspRegistryKey {
  return `${workspaceId}:${language}:${configHash}`;
}
