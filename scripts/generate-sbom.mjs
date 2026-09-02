#!/usr/bin/env node
/**
 * Generate a CycloneDX SBOM from the committed dependency manifests.
 *
 * The pnpm lockfile is parsed as YAML rather than with a package-name regex so
 * scoped packages and current pnpm lockfile keys are represented correctly.
 * Usage: node scripts/generate-sbom.mjs
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { resolveReleaseCommit } from "./release-identity.mjs";

const ROOT = process.cwd();
const SCRIPT_VERSION = "1.1.0";

function parsePnpmPackageKey(key) {
  if (typeof key !== "string" || key.startsWith("link:")) return null;

  const separator = key.startsWith("@") ? key.indexOf("@", 1) : key.indexOf("@");
  if (separator <= 0 || separator === key.length - 1) return null;

  const name = key.slice(0, separator);
  let version = key.slice(separator + 1);
  const peerSuffix = version.search(/[(_]/);
  if (peerSuffix >= 0) version = version.slice(0, peerSuffix);
  if (!name || !version) return null;

  return { name, version };
}

/**
 * Return package snapshots from a pnpm lockfile's structured packages section.
 */
export function parsePnpmDeps(lockText) {
  const lock = parseYaml(lockText);
  if (!lock || typeof lock !== "object" || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("pnpm-lock.yaml has no structured packages section");
  }

  const deps = new Map();
  for (const key of Object.keys(lock.packages)) {
    const parsed = parsePnpmPackageKey(key);
    if (parsed) deps.set(`${parsed.name}@${parsed.version}`, parsed);
  }
  return [...deps.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function parseCargoDeps(lockText) {
  const deps = new Map();
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (name && version) deps.set(`${name}@${version}`, { name, version });
  }
  return [...deps.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function deterministicSerialNumber(name, version, commit) {
  const hex = createHash("sha256").update(`${name}\0${version}\0${commit}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `urn:uuid:${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function npmPurl(name, version) {
  const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${version}`;
}

function getTimestamp(env = process.env) {
  if (typeof env.SOURCE_DATE_EPOCH === "string" && /^\d+$/.test(env.SOURCE_DATE_EPOCH)) {
    return new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }
  return new Date().toISOString();
}

export function buildSbom({ pnpmLockText, cargoLockText, appPackage, commit, timestamp = getTimestamp() }) {
  if (!appPackage?.name || !appPackage?.version) {
    throw new Error("publishable package metadata must include name and version");
  }

  const npmDeps = parsePnpmDeps(pnpmLockText);
  const cargoDeps = parseCargoDeps(cargoLockText);
  const npmComponents = npmDeps.map(({ name, version }) => ({
    type: "library",
    "bom-ref": npmPurl(name, version),
    name,
    version,
    purl: npmPurl(name, version),
  }));
  const cargoComponents = cargoDeps.map(({ name, version }) => ({
    type: "library",
    "bom-ref": `pkg:cargo/${name}@${version}`,
    name,
    version,
    purl: `pkg:cargo/${name}@${version}`,
  }));

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: deterministicSerialNumber(appPackage.name, appPackage.version, commit),
    version: 1,
    metadata: {
      timestamp,
      component: { type: "application", name: appPackage.name, version: appPackage.version },
      tools: [{ name: "my-pi-generate-sbom", version: SCRIPT_VERSION }],
      properties: [
        { name: "my-pi:commit", value: commit },
        { name: "my-pi:source", value: "apps/my-pi-mcp/package.json + pnpm-lock.yaml + Cargo.lock" },
      ],
    },
    components: [...npmComponents, ...cargoComponents],
  };
}

export async function main() {
  const appPackage = JSON.parse(await readFile(path.join(ROOT, "apps", "my-pi-mcp", "package.json"), "utf8"));
  const pnpmLockText = await readFile(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
  const cargoLockText = await readFile(path.join(ROOT, "Cargo.lock"), "utf8");
  const commit = resolveReleaseCommit({ cwd: ROOT });
  const sbom = buildSbom({ pnpmLockText, cargoLockText, appPackage, commit });
  const out = path.join(ROOT, "provenance", "SBOM.cdx.json");
  await writeFile(out, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  console.log(`SBOM written: ${out}`);
  console.log(`  npm components: ${parsePnpmDeps(pnpmLockText).length}`);
  console.log(`  cargo components: ${parseCargoDeps(cargoLockText).length}`);
  console.log(`  package: ${appPackage.name}@${appPackage.version}`);
  console.log(`  commit: ${commit}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main().catch((err) => {
    console.error(`[SBOM] Generation failed: ${err.message}`);
    process.exitCode = 1;
  });
}
