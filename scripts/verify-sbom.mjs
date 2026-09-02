#!/usr/bin/env node
/**
 * Validate the release SBOM's structure and candidate binding.
 * Usage: node scripts/verify-sbom.mjs [--sbom path] [--package path]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FULL_COMMIT_PATTERN, normalizeCommit, resolveReleaseCommit } from "./release-identity.mjs";

const ROOT = process.cwd();

function parseArgs(args) {
  const values = { sbom: path.join(ROOT, "provenance", "SBOM.cdx.json"), package: path.join(ROOT, "apps", "my-pi-mcp", "package.json") };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--sbom" || arg === "--package") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      values[arg.slice(2)] = path.resolve(ROOT, value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return values;
}

function propertyValue(properties, name) {
  return (Array.isArray(properties) ? properties : []).find((property) => property?.name === name)?.value;
}

export function validateSbom(sbom, { appPackage, releaseCommit }) {
  const errors = [];
  if (!sbom || typeof sbom !== "object" || Array.isArray(sbom)) {
    return { ok: false, errors: ["document must be a JSON object"] };
  }
  if (sbom.bomFormat !== "CycloneDX") errors.push("bomFormat must be CycloneDX");
  if (sbom.specVersion !== "1.5") errors.push("specVersion must be 1.5");
  if (sbom.version !== 1) errors.push("CycloneDX document version must be 1");

  const metadata = sbom.metadata;
  const component = metadata?.component;
  if (component?.type !== "application") errors.push("metadata.component.type must be application");
  if (component?.name !== appPackage?.name) {
    errors.push(`metadata.component.name must be ${appPackage?.name}`);
  }
  if (component?.version !== appPackage?.version) {
    errors.push(`metadata.component.version must be ${appPackage?.version}`);
  }

  const commitValue = propertyValue(metadata?.properties ?? [], "my-pi:commit");
  if (typeof commitValue !== "string" || !commitValue.trim()) {
    errors.push("metadata property my-pi:commit is missing");
  } else if (!FULL_COMMIT_PATTERN.test(commitValue.trim())) {
    errors.push("metadata property my-pi:commit must be a full 40-character SHA");
  } else if (commitValue.trim().toLowerCase() !== releaseCommit) {
    errors.push(`SBOM commit ${commitValue.trim()} does not match release commit ${releaseCommit}`);
  }

  const sourceValue = propertyValue(metadata?.properties ?? [], "my-pi:source");
  if (typeof sourceValue !== "string" || !sourceValue.includes("pnpm-lock.yaml") || !sourceValue.includes("Cargo.lock")) {
    errors.push("metadata property my-pi:source must identify the committed dependency lockfiles");
  }
  if (typeof metadata?.timestamp !== "string" || !metadata.timestamp.trim()) {
    errors.push("metadata.timestamp is missing");
  }

  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    errors.push("components must be a non-empty array");
  }
  const components = Array.isArray(sbom.components) ? sbom.components : [];
  for (const [index, entry] of components.entries()) {
    if (entry?.type !== "library" || typeof entry.name !== "string" || typeof entry.version !== "string" || typeof entry.purl !== "string") {
      errors.push(`component at index ${index} is not a valid library component`);
    }
  }
  const componentNames = new Set(components.map((entry) => entry?.name).filter((name) => typeof name === "string"));
  for (const dependencyName of Object.keys(appPackage?.dependencies ?? {})) {
    if (!componentNames.has(dependencyName)) {
      errors.push(`missing direct production dependency in SBOM: ${dependencyName}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const [sbom, appPackage] = await Promise.all([
    readFile(paths.sbom, "utf8").then((text) => JSON.parse(text)),
    readFile(paths.package, "utf8").then((text) => JSON.parse(text)),
  ]);
  const releaseCommit = resolveReleaseCommit({ cwd: ROOT });
  const result = validateSbom(sbom, { appPackage, releaseCommit: normalizeCommit(releaseCommit, { cwd: ROOT }) });
  if (!result.ok) {
    for (const error of result.errors) console.error(`  ✗ ${error}`);
    throw new Error(`SBOM verification failed with ${result.errors.length} error(s)`);
  }
  console.log(`SBOM verification PASS: ${appPackage.name}@${appPackage.version} bound to ${releaseCommit}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main().catch((err) => {
    console.error(`[SBOM] Verification failed: ${err.message}`);
    process.exitCode = 1;
  });
}
