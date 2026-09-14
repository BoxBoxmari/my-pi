#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { candidateCommit, candidateDirty } from "./candidate-state.mjs";

const ROOT = process.cwd();
const FIXTURE_PREFIX = ".my-pi/track-b-bypass-";
const RECEIPT_DIGEST = "sha256:" + "1".repeat(64);
let fixtureCounter = 0;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  const client = new Client({ name: "track-b-host-bypass-measurement", version: "1" });
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

async function writeThroughMyPi(client, relativePath, content) {
  return call(client, "fs_write", { path: relativePath, content });
}

async function readThroughMyPi(client, relativePath) {
  return call(client, "fs_read", { path: relativePath, offset: 0, max_bytes: 100000 });
}

async function writeJsonThroughMyPi(client, relativePath, value) {
  return writeThroughMyPi(client, relativePath, JSON.stringify(value, null, 2) + "\n");
}

async function prepareFixture(client, label) {
  const relative = FIXTURE_PREFIX + label + "-" + process.pid + "-" + Date.now() + "-" + fixtureCounter++;
  const fixture = path.join(ROOT, relative);
  await mkdir(path.join(fixture, "src"), { recursive: true });
  const sourceRelative = relative + "/src/feature.txt";
  await writeThroughMyPi(client, sourceRelative, "base\n");
  git(fixture, ["init", "-b", "main"]);
  git(fixture, ["config", "user.email", "my-pi-track-b@example.invalid"]);
  git(fixture, ["config", "user.name", "my-pi track-b measurement"]);
  git(fixture, ["add", "src/feature.txt"]);
  git(fixture, ["commit", "-m", "base"]);
  const base = git(fixture, ["rev-parse", "HEAD"]);
  const sourceSnapshot = await readThroughMyPi(client, sourceRelative);
  await call(client, "fs_patch", {
    path: sourceRelative,
    expected_hash: sourceSnapshot.content_hash,
    patch: { hunks: [{ old: "base\n", new: "candidate\n" }] },
  });
  git(fixture, ["add", "src/feature.txt"]);
  git(fixture, ["commit", "-m", "candidate"]);
  const firstHead = git(fixture, ["rev-parse", "HEAD"]);

  const coverage = relative + "/coverage.json";
  const provenance = relative + "/provenance.json";
  const attestation = relative + "/.my-pi/provenance/admission-attestation.json";
  const authority = relative + "/.my-pi/provenance/authority.json";
  const keyPath = path.join(os.tmpdir(), "my-pi-track-b-" + label + "-" + process.pid + "-" + Date.now() + ".pem");
  await writeJsonThroughMyPi(client, coverage, [{ path: "src/feature.txt", receiptDigest: RECEIPT_DIGEST }]);
  await writeJsonThroughMyPi(client, provenance, [{ path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest: RECEIPT_DIGEST }]);
  run(ROOT, process.execPath, [
    path.join(ROOT, "scripts", "seal-my-pi-admission.mjs"),
    "--root", fixture,
    "--base", base,
    "--head", firstHead,
    "--coverage", path.join(ROOT, coverage),
    "--key-id", "track-b-" + label,
    "--key-path", keyPath,
  ]);
  return { label, relative, fixture, source: path.join(fixture, "src", "feature.txt"), base, firstHead, coverage, provenance, attestation, authority, keyPath };
}

async function runVerifier(fixture, paths, base, head) {
  const output = run(ROOT, process.execPath, [
    path.join(ROOT, "scripts", "verify-my-pi-admission.mjs"),
    "--root", fixture,
    "--base", base,
    "--head", head,
    "--provenance", paths.provenance,
    "--attestation", paths.attestation,
    "--authority", paths.authority,
    "--coverage", paths.coverage,
    "--report-only",
  ]);
  return JSON.parse(output);
}

async function commitNativeChange(fixture, relativePath, content, message) {
  await writeFile(path.join(fixture, relativePath), content, "utf8");
  git(fixture, ["add", relativePath]);
  git(fixture, ["commit", "-m", message]);
  return git(fixture, ["rev-parse", "HEAD"]);
}

async function measureCase(client, label, options = {}) {
  const fixture = await prepareFixture(client, label);
  fixturesForCleanup.push(fixture.fixture);
  keysForCleanup.push(fixture.keyPath);
  try {
    let head = fixture.firstHead;
    let attestation = fixture.attestation;
    let authority = fixture.authority;
    let provenance = fixture.provenance;
    let sealError;
    if (options.emptyProvenance) {
      provenance = fixture.relative + "/missing-provenance.json";
      await writeJsonThroughMyPi(client, provenance, []);
    }
    if (options.tamper) {
      const value = JSON.parse((await readThroughMyPi(client, attestation)).content);
      value.subjectDigest = "sha256:" + "f".repeat(64);
      const tampered = fixture.relative + "/tampered-attestation.json";
      await writeJsonThroughMyPi(client, tampered, value);
      attestation = tampered;
    }
    if (options.wrongAuthority) {
      const value = JSON.parse((await readThroughMyPi(client, authority)).content);
      value.publicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
      const wrong = fixture.relative + "/wrong-authority.json";
      await writeJsonThroughMyPi(client, wrong, value);
      authority = wrong;
    }
    if (options.afterSeal) head = await options.afterSeal(fixture);
    if (options.extraProvenance) {
      provenance = fixture.relative + "/extra-provenance.json";
      await writeJsonThroughMyPi(client, provenance, options.extraProvenance);
    }
    if (options.incompleteSeal) {
      try {
        run(ROOT, process.execPath, [
          path.join(ROOT, "scripts", "seal-my-pi-admission.mjs"),
          "--root", fixture.fixture,
          "--base", fixture.base,
          "--head", head,
          "--coverage", path.join(ROOT, fixture.coverage),
          "--key-id", "track-b-" + label,
          "--key-path", fixture.keyPath,
        ]);
      } catch (error) {
        sealError = error.stderr?.toString?.() ?? error.message;
      }
    }
    const report = await runVerifier(fixture.fixture, {
      coverage: path.join(ROOT, fixture.coverage),
      provenance: path.join(ROOT, provenance),
      attestation: path.join(ROOT, attestation),
      authority: path.join(ROOT, authority),
    }, fixture.base, head);
    if (report.status !== options.expectedStatus) throw new Error(label + ": expected " + options.expectedStatus + ", got " + report.status);
    if (options.expectedReason !== undefined && !report.attestation.reasonCodes.includes(options.expectedReason)) throw new Error(label + ": missing reason " + options.expectedReason);
    if (options.incompleteSeal && !sealError?.includes("coverage must contain exactly one verified receipt mapping")) throw new Error(label + ": incomplete coverage was not rejected by seal");
    return {
      label,
      baseCommit: fixture.base,
      initialHead: fixture.firstHead,
      currentHead: head,
      status: report.status,
      localDecision: report.localAdmission.decision,
      attestationValid: report.attestation.valid,
      reasonCodes: report.attestation.reasonCodes,
      localReasonCodes: report.localAdmission.reasonCodes,
      sealCoverageRejected: Boolean(sealError),
    };
  } finally {
    // Windows can keep the workspace fixture open while the official my-pi client is connected.
  }
}

const { client, transport } = await connectMyPi();
const cases = [];
const fixturesForCleanup = [];
const keysForCleanup = [];
try {
  cases.push(await measureCase(client, "valid-managed", { expectedStatus: "allowed" }));
  cases.push(await measureCase(client, "missing-provenance", { expectedStatus: "rejected", emptyProvenance: true }));
  cases.push(await measureCase(client, "tampered-attestation", { expectedStatus: "review_required", expectedReason: "subject_mismatch", tamper: true }));
  cases.push(await measureCase(client, "wrong-authority-key", { expectedStatus: "review_required", expectedReason: "signature_invalid", wrongAuthority: true }));
  const commitHostMutation = (mutate, message) => async (fixture) => {
    await mutate(fixture);
    git(fixture.fixture, ["add", "src/feature.txt"]);
    git(fixture.fixture, ["commit", "-m", message]);
    return git(fixture.fixture, ["rev-parse", "HEAD"]);
  };
  const vectors = [
    ["direct-editor-write", async (fixture) => writeFile(fixture.source, "native-editor\n", "utf8"), "native editor write"],
    ["shell-redirection", async (fixture) => {
      execFileSync("cmd.exe", ["/d", "/s", "/c", "echo shell-redirection>" + fixture.source], { cwd: fixture.fixture, encoding: "utf8", windowsHide: true });
    }, "shell redirection"],
    ["scripted-write", async (fixture) => {
      run(fixture.fixture, process.execPath, ["-e", "require(\"node:fs\").writeFileSync(process.argv[1], \"scripted-write\\n\", \"utf8\")", fixture.source]);
    }, "scripted write"],
  ];
  for (const vector of vectors) {
    cases.push(await measureCase(client, vector[0], { expectedStatus: "review_required", expectedReason: "head_mismatch", afterSeal: commitHostMutation(vector[1], vector[2]) }));
  }
  cases.push(await measureCase(client, "git-apply-write", {
    expectedStatus: "review_required",
    expectedReason: "head_mismatch",
    afterSeal: async (fixture) => {
      const changed = path.join(fixture.fixture, "src", "feature.txt");
      const patchFile = path.join(fixture.fixture, "mutation.patch");
      await writeFile(changed, "git-apply\n", "utf8");
      const patch = execFileSync("git", ["diff", "--", "src/feature.txt"], { cwd: fixture.fixture, encoding: "utf8" });
      await writeFile(changed, "candidate\n", "utf8");
      await writeFile(patchFile, patch, "utf8");
      execFileSync("git", ["apply", patchFile], { cwd: fixture.fixture, encoding: "utf8" });
      git(fixture.fixture, ["add", "src/feature.txt"]);
      git(fixture.fixture, ["commit", "-m", "git apply write"]);
      return git(fixture.fixture, ["rev-parse", "HEAD"]);
    },
  }));
  cases.push(await measureCase(client, "stale-head", {
    expectedStatus: "review_required",
    expectedReason: "head_mismatch",
    afterSeal: commitHostMutation(async (fixture) => writeFile(fixture.source, "stale-head\n", "utf8"), "stale head"),
  }));
  cases.push(await measureCase(client, "extra-path", {
    expectedStatus: "review_required",
    expectedReason: "coverage_paths_mismatch",
    incompleteSeal: true,
    afterSeal: async (fixture) => {
      await writeFile(path.join(fixture.fixture, "src", "extra.txt"), "extra\n", "utf8");
      git(fixture.fixture, ["add", "src/extra.txt"]);
      git(fixture.fixture, ["commit", "-m", "extra path"]);
      return git(fixture.fixture, ["rev-parse", "HEAD"]);
    },
    extraProvenance: [
      { path: "src/feature.txt", status: "managed", reasonCodes: [], receiptDigest: RECEIPT_DIGEST },
      { path: "src/extra.txt", status: "managed", reasonCodes: [], receiptDigest: "sha256:" + "2".repeat(64) },
    ],
  }));
  cases.push(await measureCase(client, "direct-host-unprovenanced-add", {
    expectedStatus: "rejected",
    afterSeal: async (fixture) => {
      await writeFile(path.join(fixture.fixture, "src", "unprovenanced.txt"), "bypass\n", "utf8");
      git(fixture.fixture, ["add", "src/unprovenanced.txt"]);
      git(fixture.fixture, ["commit", "-m", "unprovenanced add"]);
      return git(fixture.fixture, ["rev-parse", "HEAD"]);
    },
  }));
  const evidence = {
    schemaVersion: "my-pi/track-b-host-bypass-evidence/v2",
    measurementId: "track-b-bypass-" + Date.now() + "-" + process.pid,
    measuredAt: new Date().toISOString(),
    candidate: {
      commit: candidateCommit(),
      dirty: candidateDirty(),
      sourceAuthority: "official my-pi trusted workspace",
    },
    method: {
      sourceSetup: "official my-pi fs_write/fs_patch with CAS expected_hash",
      hostVectors: ["Node direct editor write", "cmd.exe shell redirection", "Node scripted write", "git apply"],
      verifier: "scripts/verify-my-pi-admission.mjs --report-only",
      evidenceWriter: "official my-pi fs_write followed by fs_read",
    },
    expectedPolicy: {
      managedWithValidAttestation: "allowed",
      missingOrUnprovenanced: "rejected",
      staleSubjectOrInvalidAttestation: "review_required",
      incompleteCoverage: "seal rejected and report review_required",
    },
    cases,
    interpretation: {
      directEditor: "native existing-path mutation changes the Git subject and requires review",
      shellRedirection: "shell write changes the Git subject and requires review",
      scriptedWrite: "scripted write changes the Git subject and requires review",
      gitApply: "git apply changes the Git subject and requires review",
      staleHead: "old attestation is rejected against the newer head",
      extraPath: "coverage must cover every changed source path",
      wrongAuthority: "signature verification failure requires review",
      tampered: "subject tampering requires review",
    },
  };
  const evidencePath = "evidence/track-b-host-bypass-2026-09-13.json";
  let expectedHash;
  try {
    expectedHash = (await readThroughMyPi(client, evidencePath)).content_hash;
  } catch {
    expectedHash = undefined;
  }
  const writeArgs = { path: evidencePath, content: JSON.stringify(evidence, null, 2) + "\n" };
  if (expectedHash !== undefined) writeArgs.expected_hash = expectedHash;
  await call(client, "fs_write", writeArgs);
  const readback = await readThroughMyPi(client, evidencePath);
  console.log(JSON.stringify({ ok: true, evidencePath, evidenceHash: readback.content_hash, cases }, null, 2));
} finally {
  await client.close();
  await transport.close?.();
  for (const fixture of fixturesForCleanup) await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  for (const keyPath of keysForCleanup) await rm(keyPath, { force: true, maxRetries: 10, retryDelay: 250 });
}
