#!/usr/bin/env node
/**
 * Bundle apps/my-pi-mcp into a self-contained CLI executable for distribution.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";

const ROOT = process.cwd();
const APP_SRC = path.join(ROOT, "apps", "my-pi-mcp", "src", "main.ts");
const APP_DIST = path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js");

console.log("[bundle-app] Bundlets my-pi-mcp for standalone distribution...");
execSync(
  `npx esbuild "${APP_SRC}" --bundle --platform=node --format=esm --target=node22.6.0 --outfile="${APP_DIST}" --external:web-tree-sitter --external:tree-sitter-wasms`,
  { cwd: ROOT, stdio: "inherit" }
);

try {
  await fs.chmod(APP_DIST, 0o755);
} catch {
  // ignore on win32
}
console.log("[bundle-app] Bundling completed successfully.");
