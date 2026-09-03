import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("build integrity: esbuild is exact-pinned and invoked without registry resolution", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const bundleScript = await readFile("scripts/bundle-app.mjs", "utf8");
  const workspaceConfig = await readFile("pnpm-workspace.yaml", "utf8");
  assert.match(packageJson.devDependencies.esbuild, /^\d+\.\d+\.\d+$/);
  assert.match(bundleScript, /from ["']esbuild["']/);
  assert.doesNotMatch(bundleScript, /\bnpx\s+esbuild\b/);
  assert.match(workspaceConfig, /allowBuilds:\s*\r?\n\s+esbuild:\s*true/);
});

test("build integrity: final bundle has a matching external source map", async () => {
  const javascript = await readFile("apps/my-pi-mcp/dist/main.js", "utf8");
  const sourceMap = JSON.parse(await readFile("apps/my-pi-mcp/dist/main.js.map", "utf8"));
  assert.match(javascript, /# sourceMappingURL=main\.js\.map/);
  assert.equal(sourceMap.version, 3);
  assert.ok(Array.isArray(sourceMap.sources) && sourceMap.sources.length > 0);
});

test("supply-chain integrity: cargo-deny discovers the policy and the workflow pins its tool version", async () => {
  const denyConfig = await readFile("deny.toml", "utf8");
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(denyConfig, /\[licenses\][\s\S]*allow = \[[\s\S]*"MIT"/);
  assert.match(releaseWorkflow, /cargo-deny --version 0\.20\.2 --locked/);
  assert.match(releaseWorkflow, /cargo-audit --version 0\.22\.2 --locked/);
  assert.doesNotMatch(releaseWorkflow, /cargo install cargo-audit cargo-deny --locked/);
});

test("release workflow: packs once and qualifies/uploads the same artifact", async () => {
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.equal((releaseWorkflow.match(/pnpm --filter @koonwang03\/my-pi pack --pack-destination/g) ?? []).length, 1);
  assert.ok((releaseWorkflow.match(/node scripts\/pr-smoke\.mjs --artifact/g) ?? []).length >= 3);
  assert.doesNotMatch(releaseWorkflow, /node scripts\/pr-smoke\.mjs\s*\n/);
  assert.match(releaseWorkflow, /Verify artifact bytes were preserved across qualification/);
  assert.match(releaseWorkflow, /artifact_sha256/);
  assert.match(releaseWorkflow, /Generate and validate release manifest/);
  assert.match(releaseWorkflow, /dist-release\/release-manifest\.json/);
  assert.ok(releaseWorkflow.indexOf("Generate and validate candidate SBOM") < releaseWorkflow.indexOf("Bind and verify candidate evidence"));
  assert.ok(releaseWorkflow.indexOf("Bind and verify candidate evidence") < releaseWorkflow.indexOf("Checksum the exact tested artifact"));
  assert.ok(releaseWorkflow.indexOf("Checksum the exact tested artifact") < releaseWorkflow.indexOf("Upload exact artifact and qualification evidence"));
});
