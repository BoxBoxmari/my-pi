#!/usr/bin/env node
/**
 * Runtime contract guard for Issue #25.
 *
 * Fails when runtime/type compatibility drifts:
 * - engines.node floor is older than Node 24 (node:sqlite normative surface)
 * - @types/node major is newer than the normative runtime major
 * - CI has no exact lane for the declared minimum
 * - release qualification and normal CI disagree on supported majors
 * - esbuild bundle target is older than the engines floor
 * - live docs still advertise the old >=22.6.0 contract
 *
 * Usage: node scripts/check-runtime-contract.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const NORMATIVE_MAJOR = 24;
const MINIMUM_VERSION = "24.0.0";

function parseMajor(version) {
  const m = String(version).match(/(\d+)\.\d+\.\d+/);
  return m ? Number(m[1]) : undefined;
}

function enginesFloor(range) {
  const m = String(range).match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), text: `${m[1]}.${m[2]}.${m[3]}` };
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function extractWorkflowNodeVersions(yaml) {
  const versions = new Set();
  for (const m of yaml.matchAll(/node:\s*\[?([\d.\s,]+)\]?/g)) {
    for (const part of m[1].split(",")) {
      const v = part.trim();
      if (v) versions.add(v);
    }
  }
  for (const m of yaml.matchAll(/node-version:\s*(\d+(?:\.\d+(?:\.\d+)?)?)/g)) {
    versions.add(m[1]);
  }
  // Exact pins like "node: 24.0.0" inside matrix include blocks.
  for (const m of yaml.matchAll(/^\s*node:\s*(\d+(?:\.\d+(?:\.\d+)?)?)\s*$/gm)) {
    versions.add(m[1]);
  }
  return [...versions];
}

function workflowMajors(versions) {
  return [...new Set(versions.map((v) => String(v).split(".")[0]))].sort();
}

async function main() {
  const failures = [];
  const rootPkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  const appPkg = JSON.parse(await fs.readFile(path.join(ROOT, "apps/my-pi-mcp/package.json"), "utf8"));
  const ciYaml = await fs.readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const releaseYaml = await fs.readFile(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const bundleSrc = await fs.readFile(path.join(ROOT, "scripts/bundle-app.mjs"), "utf8");

  // 1. engines.node floor
  for (const [label, engines] of [["root package.json", rootPkg.engines], ["apps/my-pi-mcp/package.json", appPkg.engines]]) {
    const floor = enginesFloor(engines?.node ?? "");
    if (!floor) {
      failures.push(`${label}: engines.node "${engines?.node}" is not an explicit >=MAJOR.MINOR.PATCH floor`);
    } else if (floor.major !== NORMATIVE_MAJOR || compareVersions(floor.text, MINIMUM_VERSION) < 0) {
      failures.push(`${label}: engines.node floor ${floor.text} must be >=${MINIMUM_VERSION} (Node ${NORMATIVE_MAJOR} normative for node:sqlite)`);
    }
  }

  // 2. @types/node must not expose a newer surface than production CI supports
  const typesRange = rootPkg.devDependencies?.["@types/node"] ?? "";
  const typesMajor = parseMajor(typesRange.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "");
  if (typesMajor === undefined) {
    failures.push(`root @types/node "${typesRange}" does not contain an explicit version; pin to the normative ${NORMATIVE_MAJOR}.x line`);
  } else if (typesMajor !== NORMATIVE_MAJOR) {
    failures.push(`root @types/node major ${typesMajor} must equal normative runtime major ${NORMATIVE_MAJOR} (got "${typesRange}")`);
  }

  // 3. CI must include an exact minimum-runtime lane
  const ciVersions = extractWorkflowNodeVersions(ciYaml);
  if (!ciVersions.includes(MINIMUM_VERSION)) {
    failures.push(`ci.yml has no exact minimum-runtime lane for ${MINIMUM_VERSION} (found: ${ciVersions.join(", ") || "none"})`);
  }
  if (/\bnode:\s*22\b/.test(ciYaml)) {
    failures.push("ci.yml still contains a floating Node 22 lane; Node 24 is the normative minimum");
  }

  // 4. Release qualification must use the same runtime policy as normal CI
  const releaseVersions = extractWorkflowNodeVersions(releaseYaml);
  const ciMajors = workflowMajors(ciVersions);
  const releaseMajors = workflowMajors(releaseVersions);
  if (JSON.stringify(ciMajors) !== JSON.stringify(releaseMajors)) {
    failures.push(`CI majors [${ciMajors}] and release majors [${releaseMajors}] disagree; they must use the same runtime policy`);
  }
  if (!releaseVersions.includes(MINIMUM_VERSION)) {
    failures.push(`release.yml has no exact minimum-runtime lane for ${MINIMUM_VERSION} (found: ${releaseVersions.join(", ") || "none"})`);
  }
  if (/\bnode:\s*22\b/.test(releaseYaml)) {
    failures.push("release.yml still contains a floating Node 22 lane; Node 24 is the normative minimum");
  }

  // 5. Bundle target must not be older than the engines floor
  const targetMatch = bundleSrc.match(/target:\s*"node(\d+)\.(\d+)\.(\d+)"/);
  if (!targetMatch) {
    failures.push("scripts/bundle-app.mjs has no explicit nodeMAJOR.MINOR.PATCH esbuild target");
  } else {
    const target = `${targetMatch[1]}.${targetMatch[2]}.${targetMatch[3]}`;
    if (compareVersions(target, MINIMUM_VERSION) < 0) {
      failures.push(`esbuild target node${target} is older than engines floor ${MINIMUM_VERSION}`);
    }
  }

  // 6. Live docs must not advertise the old contract
  const docPaths = [
    "CONTRIBUTING.md",
    "docs/release/DISTRIBUTION.md",
    "apps/my-pi-mcp/README.md",
  ];
  for (const rel of docPaths) {
    try {
      const text = await fs.readFile(path.join(ROOT, rel), "utf8");
      if (text.includes(">=22.6.0") || /\bNode 22 and Node 24 qualification lanes\b/.test(text)) {
        failures.push(`${rel} still advertises the retired >=22.6.0 / Node-22-lane contract`);
      }
    } catch {
      failures.push(`${rel} is missing; cannot verify runtime docs`);
    }
  }

  if (failures.length > 0) {
    console.error("=== RUNTIME CONTRACT CHECK: FAIL ===");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`=== RUNTIME CONTRACT CHECK: PASS (normative Node ${NORMATIVE_MAJOR}, floor ${MINIMUM_VERSION}) ===`);
}

await main();
