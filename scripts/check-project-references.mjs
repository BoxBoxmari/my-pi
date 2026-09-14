#!/usr/bin/env node
/**
 * R0.1.1: project-reference validation.
 *
 * Rule: for every workspace package, each `@my-pi/*` (or legacy `@ccr/*`)
 * entry in package.json dependencies/devDependencies must have a matching
 * entry in that package's tsconfig.json `references`. This prevents the
 * class of build failure where a TS composite project imports a workspace
 * package it does not reference (verified real case: mcp-adapter imported
 * @my-pi/fs without a `../fs` reference -> clean `tsc --build` failed
 * with TS2307).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PACKAGES_DIR = path.join(ROOT, "packages");
const APPS_DIR = path.join(ROOT, "apps");

let failures = 0;

function refNameFromPath(ref) {
  const raw = typeof ref === "string" ? ref : ref?.path ?? "";
  return String(raw).replace(/\\/g, "/").replace(/^\.\.\//, "");
}

async function refPackageName(dir, ref) {
  const raw = typeof ref === "string" ? ref : ref?.path ?? "";
  try {
    const referencedPackage = JSON.parse(await readFile(path.join(dir, raw, "package.json"), "utf8"));
    const name = typeof referencedPackage.name === "string" ? referencedPackage.name : "";
    if (name.startsWith("@ccr/") || name.startsWith("@my-pi/")) return name.replace(/^@(?:ccr|my-pi)\//, "");
  } catch {
    // Fall back to the path name for references without a package manifest.
  }
  return refNameFromPath(ref).split("/").filter(Boolean).pop();
}

async function checkOne(dir) {
  const pkgPath = path.join(dir, "package.json");
  const tsPath = path.join(dir, "tsconfig.json");
  let pkg;
  let tsconfig;
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  } catch {
    return; // not a package
  }
  try {
    tsconfig = JSON.parse(await readFile(tsPath, "utf8"));
  } catch {
    return; // no TS project
  }

  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const workspaceDeps = Object.keys(deps).filter(
    (d) => d.startsWith("@ccr/") || d.startsWith("@my-pi/"),
  );
  if (workspaceDeps.length === 0) return;

  // Prefer the referenced package manifest so app directories such as
  // my-pi-ui can still provide the workspace package identity ui.
  const refNames = new Set(
    (await Promise.all((tsconfig.references ?? []).map((ref) => refPackageName(dir, ref)))).filter(Boolean),
  );

  for (const dep of workspaceDeps) {
    const short = dep.replace(/^@(?:ccr|my-pi)\//, "");
    if (!refNames.has(short)) {
      const relDir = path.relative(ROOT, dir).replace(/\\/g, "/");
      console.error(
        `REFERENCE VIOLATION: ${relDir} depends on "${dep}" (package.json) but tsconfig.json references lack "${short}"`,
      );
      failures++;
    }
  }
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    await checkOne(full);
    await walk(full); // nested (e.g. none expected, but safe)
  }
}

await walk(PACKAGES_DIR);
await walk(APPS_DIR);

if (failures > 0) {
  console.error(`\n${failures} project-reference violation(s). Fix tsconfig references before building.`);
  process.exit(1);
}
console.log("project-reference validation: PASS (every @my-pi/* dependency has a matching tsconfig reference)");
