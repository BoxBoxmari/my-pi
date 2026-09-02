import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildSbom, parsePnpmDeps } from "../../scripts/generate-sbom.mjs";
import { validateSbom } from "../../scripts/verify-sbom.mjs";

const RELEASE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const appPackage = {
  name: "my-pi",
  version: "0.1.0-alpha.1",
  dependencies: {
    "@modelcontextprotocol/core": "2.0.0",
    "@modelcontextprotocol/server": "2.0.0",
    "tree-sitter-wasms": "^0.1.13",
    "web-tree-sitter": "^0.22.6",
    zod: "^4.5.4",
  },
};

const pnpmLockText = `
lockfileVersion: '9.0'
packages:
  '@modelcontextprotocol/core@2.0.0': {}
  '@modelcontextprotocol/server@2.0.0': {}
  tree-sitter-wasms@0.1.13: {}
  web-tree-sitter@0.22.6: {}
  zod@4.5.4: {}
`;
const cargoLockText = `
[[package]]
name = "my-pi-native"
version = "0.1.0"
`;

function makeSbom() {
  return buildSbom({
    pnpmLockText,
    cargoLockText,
    appPackage,
    commit: RELEASE_COMMIT,
    timestamp: "2026-09-02T00:00:00.000Z",
  });
}

test("SBOM parser retains scoped pnpm package names", () => {
  const dependencies = parsePnpmDeps(pnpmLockText);
  assert.ok(dependencies.some((dependency) => dependency.name === "@modelcontextprotocol/core" && dependency.version === "2.0.0"));
  assert.ok(dependencies.some((dependency) => dependency.name === "@modelcontextprotocol/server" && dependency.version === "2.0.0"));
});

test("SBOM generation derives release version, commit, and direct dependency inventory", () => {
  const sbom = makeSbom();
  assert.equal(sbom.metadata.component.name, "my-pi");
  assert.equal(sbom.metadata.component.version, appPackage.version);
  assert.equal(sbom.metadata.properties.find((property) => property.name === "my-pi:commit").value, RELEASE_COMMIT);
  assert.deepEqual(
    appPackageDependencies(sbom),
    Object.keys(appPackage.dependencies).sort(),
  );
  assert.equal(sbom.serialNumber, makeSbom().serialNumber);
});

function appPackageDependencies(sbom) {
  return sbom.components
    .map((component) => component.name)
    .filter((name) => Object.hasOwn(appPackage.dependencies, name))
    .sort();
}

test("SBOM validator accepts a current, structurally valid document", () => {
  const result = validateSbom(makeSbom(), { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("SBOM validator rejects the wrong release version", () => {
  const sbom = makeSbom();
  sbom.metadata.component.version = "0.1.0";
  const result = validateSbom(sbom, { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /component.version/.test(error)));
});

test("SBOM validator rejects a stale release commit", () => {
  const sbom = makeSbom();
  sbom.metadata.properties.find((property) => property.name === "my-pi:commit").value = "0000000000000000000000000000000000000000";
  const result = validateSbom(sbom, { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /does not match release commit/.test(error)));
});

test("SBOM validator rejects a missing direct production dependency", () => {
  const sbom = makeSbom();
  sbom.components = sbom.components.filter((component) => component.name !== "@modelcontextprotocol/core");
  const result = validateSbom(sbom, { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /@modelcontextprotocol\/core/.test(error)));
});

test("SBOM validator rejects malformed and empty documents", () => {
  const malformed = validateSbom({ bomFormat: "SPDX" }, { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.some((error) => /bomFormat/.test(error)));

  const empty = makeSbom();
  empty.components = [];
  const emptyResult = validateSbom(empty, { appPackage, releaseCommit: RELEASE_COMMIT });
  assert.equal(emptyResult.ok, false);
  assert.ok(emptyResult.errors.some((error) => /non-empty array/.test(error)));
});
