#!/usr/bin/env node
/**
 * G0.2: generate a REAL CycloneDX SBOM from the committed lockfiles
 * (pnpm-lock.yaml + Cargo.lock) — no placeholder. Records package names,
 * versions, and dependency counts.
 *
 * Usage: node scripts/generate-sbom.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

// Parse pnpm-lock.yaml (lockfileVersion 9): entries look like
//   'name@1.2.3':            (quoted)
//   name@1.2.3:              (unquoted)
// Skip link: workspace entries (they have no version).
function parsePnpmDeps(lockText) {
  const deps = new Set();
  const lines = lockText.split(/\r?\n/);
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages && /^\S/.test(line)) { inPackages = false; }
    if (!inPackages) continue;
    const m = line.match(/^ {2}'?([^'@:]+)'?@(\d[^:]*):\s*$/);
    if (m) deps.add(`${m[1]}@${m[2]}`);
  }
  return [...deps];
}

function parseCargoDeps(lockText) {
  const deps = new Set();
  const re = /^\[\[package\]\]\r?\nname = "(.+?)"\r?\nversion = "(.+?)"/gm;
  let m;
  while ((m = re.exec(lockText)) !== null) deps.add(`${m[1]}@${m[2]}`);
  return [...deps];
}

const pnpmLock = await readFile(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
const cargoLock = await readFile(path.join(ROOT, "Cargo.lock"), "utf8");

const npmDeps = parsePnpmDeps(pnpmLock);
const cargoDeps = parseCargoDeps(cargoLock);

const commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: "coding-capability-runtime", version: "0.1.0" },
    tools: [{ name: "ccr-generate-sbom", version: "1.0.0" }],
    properties: [
      { name: "ccr:commit", value: commit },
      { name: "ccr:source", value: "generated from pnpm-lock.yaml + Cargo.lock" },
    ],
  },
  components: [
    ...npmDeps.map((d) => {
      const at = d.lastIndexOf("@");
      const name = d.slice(0, at).replace(/^'|'$/g, "");
      const version = d.slice(at + 1);
      return { type: "library", "bom-ref": `pkg:npm/${name}@${version}`, name, version, purl: `pkg:npm/${name}@${version}` };
    }),
    ...cargoDeps.map((d) => {
      const at = d.lastIndexOf("@");
      const name = d.slice(0, at);
      const version = d.slice(at + 1);
      return { type: "library", "bom-ref": `pkg:cargo/${name}@${version}`, name, version, purl: `pkg:cargo/${name}@${version}` };
    }),
  ],
};

const out = path.join(ROOT, "provenance", "SBOM.cdx.json");
await writeFile(out, JSON.stringify(sbom, null, 2), "utf8");
console.log(`SBOM written: ${out}`);
console.log(`  npm components: ${npmDeps.length}`);
console.log(`  cargo components: ${cargoDeps.length}`);
console.log(`  commit: ${commit}`);
