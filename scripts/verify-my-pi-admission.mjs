#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateLocalAdmission, normalizeGitPath, verifyAdmissionAttestation } from "../packages/change-runtime/dist/index.js";
import { subjectFromGit, assertCleanCandidate } from "./admission-git.mjs";

function args(argv) {
  const result = { reportOnly: false, strict: true };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--report-only") result.reportOnly = true;
    else if (token === "--non-strict") result.strict = false;
    else if (token === "--help") result.help = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
      result[key] = argv[++index];
    }
    else throw new Error(`unexpected argument: ${token}`);
  }
  return result;
}

async function jsonFile(file, fallback) {
  if (file === undefined) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

function usage() {
  return "Usage: node scripts/verify-my-pi-admission.mjs --base <sha> --head <sha> [--repository <id>] [--provenance <json>] [--attestation <json> --authority <json>] [--report-only]";
}

const options = args(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}
const root = path.resolve(options.root ?? process.cwd());
if (typeof options.base !== "string" || typeof options.head !== "string") throw new Error(`${usage()}\nbase and head are required`);
if (!options.reportOnly) assertCleanCandidate(root);
const subject = subjectFromGit(root, { repository: options.repository, base: options.base, head: options.head });
const provenanceValue = await jsonFile(options.provenance, { results: [] });
const provenance = Array.isArray(provenanceValue) ? provenanceValue : provenanceValue.results ?? [];
const localAdmission = evaluateLocalAdmission({ subject, provenance, strict: options.strict, explicitExemptions: Array.isArray(provenanceValue.exemptions) ? provenanceValue.exemptions : [] });
let attestationResult = { valid: false, reasonCodes: ["missing_attestation"] };
if (options.attestation !== undefined || options.authority !== undefined) {
  if (options.attestation === undefined || options.authority === undefined) throw new Error("attestation and authority must be supplied together");
  const attestation = await jsonFile(options.attestation);
  const authority = await jsonFile(options.authority);
  const coverageValue = await jsonFile(options.coverage, undefined);
  const explicitCoverage = Array.isArray(coverageValue) ? coverageValue : coverageValue?.results;
  const expectedCoverage = explicitCoverage ?? subject.changes.map((change) => {
    const evidence = provenance.find((item) => item.path === change.path);
    return { path: change.path, receiptDigest: evidence?.receiptDigest ?? "missing" };
  });
  const subjectPaths = new Set(subject.changes.map((change) => change.path));
  let coveragePathsMatch = false;
  try {
    const coveragePaths = new Set(expectedCoverage.map((entry, index) => normalizeGitPath(entry?.path, `coverage[${index}].path`)));
    coveragePathsMatch = coveragePaths.size === expectedCoverage.length && coveragePaths.size === subjectPaths.size && [...subjectPaths].every((sourcePath) => coveragePaths.has(sourcePath));
  } catch {
    coveragePathsMatch = false;
  }
  attestationResult = coveragePathsMatch
    ? verifyAdmissionAttestation({ attestation, authority, expectedSubjectDigest: subject.subjectDigest, expectedCoverage, expectedBaseCommit: subject.baseCommit, expectedHeadCommit: subject.headCommit })
    : { valid: false, reasonCodes: ["coverage_paths_mismatch"] };
}
const status = localAdmission.decision === "allowed" && attestationResult.valid ? "allowed" : localAdmission.decision === "rejected" ? "rejected" : "review_required";
const report = { schemaVersion: "my-pi/admission-report/v1", mode: "report", status, subject: { repositoryIdentity: subject.repositoryIdentity, base: subject.baseCommit, head: subject.headCommit, digest: subject.subjectDigest, changedPaths: subject.changes.map((change) => change.path) }, localAdmission, attestation: attestationResult };
console.log(JSON.stringify(report, null, 2));
if (!options.reportOnly && status !== "allowed") process.exitCode = 1;
