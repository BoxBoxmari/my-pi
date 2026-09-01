/**
 * @ccr/fs — capability package re-export.
 * Real fs capabilities (fs_read, fs_stat, fs_write, fs_patch) are implemented
 * in @ccr/mcp-adapter via workspace-runtime + hashline. This package satisfies
 * the repository structure and dependency direction (mcp-adapter -> fs -> workspace-runtime).
 */
export const FS_CAPABILITIES = ["fs_read", "fs_stat", "fs_write", "fs_patch"] as const;
