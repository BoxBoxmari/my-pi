#!/usr/bin/env node
/**
 * Bundle apps/my-pi-mcp into a self-contained CLI executable for distribution.
 */
import { build, version as esbuildVersion } from "esbuild";
import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";

const ROOT = process.cwd();
const APP_SRC = path.join(ROOT, "apps", "my-pi-mcp", "src", "main.ts");
const APP_DIST = path.join(ROOT, "apps", "my-pi-mcp", "dist", "main.js");

const APP_MAP = `${APP_DIST}.map`;

console.log(`[bundle-app] Bundling my-pi-mcp with locked esbuild ${esbuildVersion}...`);
await build({
  absWorkingDir: ROOT,
  entryPoints: [APP_SRC],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.6.0",
  outfile: APP_DIST,
  external: ["web-tree-sitter", "tree-sitter-wasms"],
  sourcemap: true,
  sourcesContent: true,
});

const bundledJs = await fs.readFile(APP_DIST, "utf8");
if (!bundledJs.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("bundled CLI is missing its Node.js shebang");
}
if (!bundledJs.includes(`//# sourceMappingURL=${path.basename(APP_MAP)}`)) {
  throw new Error("bundled CLI is missing the source map reference for its final JavaScript bytes");
}

const sourceMap = JSON.parse(await fs.readFile(APP_MAP, "utf8"));
if (sourceMap.version !== 3 || !Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
  throw new Error("bundled source map does not describe the final JavaScript output");
}

try {
  await fs.chmod(APP_DIST, 0o755);
} catch {
  // ignore on win32
}
console.log("[bundle-app] Bundling completed successfully.");
