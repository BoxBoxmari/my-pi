#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { candidateCommit, candidateDirty, candidateStateDigest } from "./candidate-state.mjs";

const ROOT = process.cwd();
const FIXTURE_PREFIX = ".my-pi/track-b-report-mode-";
const RECEIPT_DIGEST = "sha256:" + "1".repeat(64);
let fixtureCounter = 0;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}

function run(root, command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

async function connectMyPi() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps/my-pi-mcp/dist/main.js"), "--workspace", ROOT, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "track-b-report-mode-measurement", version: "1" });
  await client.connect(transport);
  return { client, transport };
}

function unwrap(result) {
  if (result.isError) throw new Error(result.content?.map((item) => item.text ?? "").join("\n") || "my-pi tool failed");
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("my-pi tool returned no text content");
  const envelope = JSON.parse(text);
  if (envelope.error) throw new Error(envelope.error.message ?? JSON.stringify(envelope.error));
  return envelope.data;
}

async function call(client, name, args) {
  return unwrap(await client.callTool({ name, arguments: args }));
}

async function writeThroughMyPi(client, relativePath, content, expectedHash) {
  const args = { path: relativePath, content };
  if (expectedHash !== undefined) args.expected_hash = expectedHash;
  return call(client, "fs_write", args);
}

async function readThroughMyPi(client, relativePath) {
  return call(client, "fs_read", { path: relativePath, offset: 0, max_bytes: 100000 });
}

async function writeJsonThroughMyPi(client, relativePath, value, expectedHash) {
  const args = { path: relativePath, content: JSON.stringify(value, null, 2) + "\n" };
  if (expectedHash !== undefined) args.expected_hash = expectedHash;
  return call(client, "fs_write", args);
}

async function prepareFixture(client, label) {
  const relative = FIXTURE_PREFIX + label + "-" + process.pid + "-" + Date.now() + "-" + fixtureCounter++;
  const fixture = path.join(ROOT, relative);
  await mkdir(path.join(fixture, "src"), { recursive: true });
  const sourceRelative = relative + "/src/feature.txt";
  await writeThroughMyPi(client, sourceRelative, "base\n");
  git(fixture, ["init", "-b", "main"]);
  git(fixture, ["config", "user.email", "my-pi-track-b@example.invalid"]);
  git(fixture, ["config", "user.name", "my-pi report-mode measurement"]);
  git(fixture, ["add", "src/feature.txt"]);
  git(fixture, ["commit", "-m", "base"]);
  const base = git(fixture, ["rev-parse", "HEAD"]);

  const snapshot = await readThroughMyPi(client, sourceRelative);
  await call(client, "fs_patch", {
    path: sourceRelative,
    expected_hash: snapshot.content_hash,
    patch: { hunks: [{ old: "base\n", new: "candidate\n" }] },
  });
  git(fixture, ["add", "src/feature.txt"]);
  git(fixture, ["commit", "-m", "candidate"]);
  const candidateHead = git(fixture, ["rev-parse", "HEAD"]);
  const branch = "pull/" + label;
  git(fixture, ["branch", branch, candidateHead]);

  const coverage = relative + "/coverage.json";
  const provenance = relative + "/provenance.json";
  const attestation = relative + "/.my-pi/provenance/admission-attestation.json";
  const authority = relative + "/.my-pi/provenance/authority.json";
  const keyPath = path.join(os.tmpdir(), "my-pi-track-b-report-mode-" + label + "-" + process.pid + "-" + Date.now() + ".pem");
  const coverageValue = [{ path: "src/feature.txt", receiptDigest: RECEIPT_DIGEST }];
  const provenanceValue = [{ path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest: RECEIPT_DIGEST }];
  await writeJsonThroughMyPi(client, coverage, coverageValue);
  await writeJsonThroughMyPi(client, provenance, provenanceValue);
  run(ROOT, process.execPath, [
    path.join(ROOT, "scripts", "seal-my-pi-admission.mjs"),
    "--root", fixture,
    "--base", base,
    "--head", candidateHead,
    "--coverage", path.join(ROOT, coverage),
    "--key-id", "track-b-report-mode-" + label,
    "--key-path", keyPath,
  ]);
  return { label, relative, fixture, sourceRelative, base, candidateHead, branch, coverage, provenance, attestation, authority, keyPath };
}

async function runReport(fixture, paths, head) {
  const args = [
    path.join(ROOT, "scripts", "verify-my-pi-admission.mjs"),
    "--root", fixture.fixture,
    "--base", fixture.base,
    "--head", head,
    "--provenance", path.join(ROOT, paths.provenance),
    "--attestation", path.join(ROOT, paths.attestation),
    "--authority", path.join(ROOT, paths.authority),
    "--coverage", path.join(ROOT, paths.coverage),
    "--report-only",
  ];
  const stdout = run(ROOT, process.execPath, args);
  const report = JSON.parse(stdout);
  return {
    command: ["node", ...args],
    stdout,
    stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
    report,
  };
}

async function commitFixtureChange(client, fixture, relativePath, content, message) {
  const target = fixture.relative + "/" + relativePath;
  let expectedHash;
  try {
    expectedHash = (await readThroughMyPi(client, target)).content_hash;
  } catch {
    expectedHash = undefined;
  }
  await writeThroughMyPi(client, target, content, expectedHash);
  git(fixture.fixture, ["add", relativePath]);
  git(fixture.fixture, ["commit", "-m", message]);
  return git(fixture.fixture, ["rev-parse", "HEAD"]);
}

const fixturesForCleanup = [];
const keysForCleanup = [];
const candidateSnapshot = {
  commit: candidateCommit(),
  dirty: candidateDirty(),
  sourceStateDigest: await candidateStateDigest(),
  sourceAuthority: "official my-pi trusted workspace",
};
if (candidateSnapshot.dirty) throw new Error("report-mode measurement requires a clean candidate source state");
const { client, transport } = await connectMyPi();
try {
  const cases = [];

  const valid = await prepareFixture(client, "valid-pr");
  fixturesForCleanup.push(valid.fixture);
  keysForCleanup.push(valid.keyPath);
  const validReport = await runReport(valid, valid, valid.candidateHead);
  if (validReport.report.status !== "allowed") throw new Error(`valid-pr: expected allowed, got ${validReport.report.status}`);
  if (validReport.report.subject.head !== valid.candidateHead) throw new Error("valid-pr: report head did not match exact candidate head");
  cases.push({
    label: valid.label,
    fixtureBranch: valid.branch,
    baseCommit: valid.base,
    candidateHead: valid.candidateHead,
    requestedHead: valid.candidateHead,
    reportHead: validReport.report.subject.head,
    status: validReport.report.status,
    localDecision: validReport.report.localAdmission.decision,
    attestationValid: validReport.report.attestation.valid,
    reasonCodes: validReport.report.attestation.reasonCodes,
    output: validReport,
  });

  const stale = await prepareFixture(client, "stale-pr");
  fixturesForCleanup.push(stale.fixture);
  keysForCleanup.push(stale.keyPath);
  const staleHead = await commitFixtureChange(client, stale, "src/feature.txt", "stale-head\n", "stale head after seal");
  const staleReport = await runReport(stale, stale, staleHead);
  if (staleReport.report.status !== "review_required" || !staleReport.report.attestation.reasonCodes.includes("head_mismatch")) throw new Error("stale-pr: stale candidate was not held for review");
  cases.push({
    label: stale.label,
    fixtureBranch: stale.branch,
    baseCommit: stale.base,
    candidateHead: stale.candidateHead,
    requestedHead: staleHead,
    reportHead: staleReport.report.subject.head,
    status: staleReport.report.status,
    localDecision: staleReport.report.localAdmission.decision,
    attestationValid: staleReport.report.attestation.valid,
    reasonCodes: staleReport.report.attestation.reasonCodes,
    output: staleReport,
  });

  const tampered = await prepareFixture(client, "tampered-pr");
  fixturesForCleanup.push(tampered.fixture);
  keysForCleanup.push(tampered.keyPath);
  const attestationValue = JSON.parse((await readThroughMyPi(client, tampered.attestation)).content);
  attestationValue.subjectDigest = "sha256:" + "f".repeat(64);
  const tamperedAttestation = tampered.relative + "/tampered-attestation.json";
  await writeJsonThroughMyPi(client, tamperedAttestation, attestationValue);
  const tamperedReport = await runReport(tampered, { ...tampered, attestation: tamperedAttestation }, tampered.candidateHead);
  if (tamperedReport.report.status !== "review_required" || !tamperedReport.report.attestation.reasonCodes.includes("subject_mismatch")) throw new Error("tampered-pr: tampered attestation was not held for review");
  cases.push({
    label: tampered.label,
    fixtureBranch: tampered.branch,
    baseCommit: tampered.base,
    candidateHead: tampered.candidateHead,
    requestedHead: tampered.candidateHead,
    reportHead: tamperedReport.report.subject.head,
    status: tamperedReport.report.status,
    localDecision: tamperedReport.report.localAdmission.decision,
    attestationValid: tamperedReport.report.attestation.valid,
    reasonCodes: tamperedReport.report.attestation.reasonCodes,
    output: tamperedReport,
  });

  const uncovered = await prepareFixture(client, "uncovered-pr");
  fixturesForCleanup.push(uncovered.fixture);
  keysForCleanup.push(uncovered.keyPath);
  const uncoveredHead = await commitFixtureChange(client, uncovered, "src/uncovered.txt", "uncovered\n", "uncovered source path");
  const extraProvenance = uncovered.relative + "/extra-provenance.json";
  await writeJsonThroughMyPi(client, extraProvenance, [
    { path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest: RECEIPT_DIGEST },
    { path: "src/uncovered.txt", status: "managed", reasonCodes: [], receiptDigest: "sha256:" + "2".repeat(64) },
  ]);
  const uncoveredReport = await runReport(uncovered, { ...uncovered, provenance: extraProvenance }, uncoveredHead);
  if (uncoveredReport.report.status !== "review_required" || !uncoveredReport.report.attestation.reasonCodes.includes("coverage_paths_mismatch")) throw new Error("uncovered-pr: uncovered path was not held for review");
  cases.push({
    label: uncovered.label,
    fixtureBranch: uncovered.branch,
    baseCommit: uncovered.base,
    candidateHead: uncovered.candidateHead,
    requestedHead: uncoveredHead,
    reportHead: uncoveredReport.report.subject.head,
    status: uncoveredReport.report.status,
    localDecision: uncoveredReport.report.localAdmission.decision,
    attestationValid: uncoveredReport.report.attestation.valid,
    reasonCodes: uncoveredReport.report.attestation.reasonCodes,
    output: uncoveredReport,
  });

  const evidence = {
    schemaVersion: "my-pi/track-b-report-mode-evidence/v1",
    measurementId: "track-b-report-mode-" + Date.now() + "-" + process.pid,
    measuredAt: new Date().toISOString(),
    candidate: candidateSnapshot,
    method: {
      fixtureSetup: "official my-pi fs_write/fs_patch with CAS expected_hash",
      verifier: "scripts/verify-my-pi-admission.mjs --report-only",
      fixtureShape: "isolated Git main plus pull/* branch with exact base/head commits",
      evidenceWriter: "official my-pi fs_write followed by fs_read",
      preservedOutput: "raw verifier stdout plus sha256 digest per case",
    },
    expectedPolicy: {
      validCandidate: "allowed",
      staleCandidate: "review_required",
      tamperedAttestation: "review_required",
      uncoveredPath: "review_required",
    },
    cases,
    assertions: {
      exactCandidateHeadChecked: cases.every((entry) => entry.reportHead === entry.requestedHead),
      validCandidateHeadChecked: cases.find((entry) => entry.label === "valid-pr")?.candidateHead === cases.find((entry) => entry.label === "valid-pr")?.requestedHead,
      validAllowed: cases.find((entry) => entry.label === "valid-pr")?.status === "allowed",
      negativeCasesHeld: cases.filter((entry) => entry.label !== "valid-pr").every((entry) => entry.status === "review_required"),
    },
  };
  const evidencePath = "evidence/track-b-report-mode-2026-09-15.json";
  let expectedHash;
  try {
    expectedHash = (await readThroughMyPi(client, evidencePath)).content_hash;
  } catch {
    expectedHash = undefined;
  }
  const written = await writeJsonThroughMyPi(client, evidencePath, evidence, expectedHash);
  const readback = await readThroughMyPi(client, evidencePath);
  if (written.content_hash !== readback.content_hash) throw new Error("report-mode evidence changed between write and readback");
  console.log(JSON.stringify({ ok: true, evidencePath, evidenceHash: readback.content_hash, candidate: evidence.candidate, cases: cases.map(({ output, ...entry }) => entry) }, null, 2));
} finally {
  await client.close();
  await transport.close?.();
  for (const fixture of fixturesForCleanup) await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  for (const keyPath of keysForCleanup) await rm(keyPath, { force: true, maxRetries: 10, retryDelay: 250 });
}
