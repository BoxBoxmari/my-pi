#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdmissionAttestation, loadOrCreateAuthorityIdentity, normalizeGitPath } from "../packages/change-runtime/dist/index.js";
import { subjectFromGit } from "./admission-git.mjs";

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--help") result.help = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
      result[key] = argv[++index];
    }
    else throw new Error(`unexpected argument: ${token}`);
  }
  return result;
}

const options = args(process.argv.slice(2));
if (options.help) {
  console.log("Usage: node scripts/seal-my-pi-admission.mjs --base <sha> --head <sha> --coverage <json> [--key-id <id>] [--key-path <path>]");
  process.exit(0);
}
const root = path.resolve(options.root ?? process.cwd());
if (typeof options.base !== "string" || typeof options.head !== "string" || typeof options.coverage !== "string") throw new Error("base, head, and coverage are required");
const subject = subjectFromGit(root, { repository: options.repository, base: options.base, head: options.head });
const coverageValue = JSON.parse(await readFile(options.coverage, "utf8"));
const coverage = Array.isArray(coverageValue) ? coverageValue : coverageValue.results ?? [];
if (coverage.length === 0) throw new Error("coverage must contain at least one verified receipt mapping");
const subjectPaths = new Set(subject.changes.map((change) => change.path));
const coveragePaths = new Set(coverage.map((entry, index) => normalizeGitPath(entry?.path, `coverage[${index}].path`)));
if (coveragePaths.size !== coverage.length || coveragePaths.size !== subjectPaths.size || [...subjectPaths].some((sourcePath) => !coveragePaths.has(sourcePath)) || [...coveragePaths].some((coveredPath) => !subjectPaths.has(coveredPath))) throw new Error("coverage must contain exactly one verified receipt mapping for every changed source path");
const identity = await loadOrCreateAuthorityIdentity({ keyId: options.keyId ?? "local-default", privateKeyPath: options.keyPath, workspaceRoots: [root] });
const attestation = createAdmissionAttestation({ subjectDigest: subject.subjectDigest, repositoryIdentity: subject.repositoryIdentity, baseCommit: subject.baseCommit, headCommit: subject.headCommit, coveredReceipts: coverage, authorityKeyId: identity.keyId, privateKey: identity.privateKeyPem });
const outputDir = path.join(root, ".my-pi", "provenance");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "admission-attestation.json"), `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "authority.json"), `${JSON.stringify({ keyId: identity.keyId, publicKeyPem: identity.publicKeyPem }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "SEALED", subjectDigest: subject.subjectDigest, attestation: ".my-pi/provenance/admission-attestation.json", authority: ".my-pi/provenance/authority.json", privateKeyPath: identity.privateKeyPath }, null, 2));
