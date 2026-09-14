#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { STRICT_CANDIDATE_PROFILES, REQUIRED_BYPASS_VECTORS, renderPolicyBundle } from "@my-pi/host-profiles";
import { candidateCommit, candidateDirty, candidateStateDigest } from "./candidate-state.mjs";

const ROOT = process.cwd();
const BYPASS_EVIDENCE = "evidence/track-b-host-bypass-2026-09-13.json";
const EVIDENCE_PATH = "evidence/track-b-strict-candidate-2026-09-15.json";
const CONFIG_PATH = ".my-pi/track-b-strict-candidate-opencode-config.json";

function run(root, command, args, options = {}) {
  const windowsCommandShim = process.platform === "win32" && /\.cmd$/i.test(command);
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...(windowsCommandShim ? { shell: true } : {}),
    ...options,
  });
}

async function connectMyPi() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "apps/my-pi-mcp/dist/main.js"), "--workspace", ROOT, "--security-profile", "trusted"],
    cwd: ROOT,
    stderr: "pipe",
  });
  const client = new Client({ name: "track-b-strict-candidate-measurement", version: "1" });
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

async function readThroughMyPi(client, relativePath) {
  return call(client, "fs_read", { path: relativePath, offset: 0, max_bytes: 200000 });
}

async function writeThroughMyPi(client, relativePath, content, expectedHash) {
  const args = { path: relativePath, content };
  if (expectedHash !== undefined) args.expected_hash = expectedHash;
  return call(client, "fs_write", args);
}

async function writeJsonThroughMyPi(client, relativePath, value, expectedHash) {
  return writeThroughMyPi(client, relativePath, JSON.stringify(value, null, 2) + "\n", expectedHash);
}

function hostCommand() {
  return process.platform === "win32" ? "opencode.cmd" : "opencode";
}

const candidate = {
  commit: candidateCommit(),
  dirty: candidateDirty(),
  sourceStateDigest: await candidateStateDigest(),
  sourceAuthority: "official my-pi trusted workspace",
};
if (candidate.dirty) throw new Error("strict-candidate measurement requires a clean candidate source state");

const profile = STRICT_CANDIDATE_PROFILES.find((item) => item.id === "opencode-local-strict");
if (!profile) throw new Error("opencode-local-strict profile is missing");

const { client, transport } = await connectMyPi();
try {
  const bypassEvidence = JSON.parse((await readThroughMyPi(client, BYPASS_EVIDENCE)).content);
  const vectorCases = new Map([
    ["native-edit", "direct-editor-write"],
    ["shell-redirection", "shell-redirection"],
    ["scripted-write", "scripted-write"],
    ["alternate-mcp-filesystem", "alternate-mcp-filesystem"],
    ["direct-git-patch", "git-apply-write"],
  ]);
  const casesByLabel = new Map(bypassEvidence.cases.map((entry) => [entry.label, entry]));
  const bypassResults = REQUIRED_BYPASS_VECTORS.map((vector) => {
    const label = vectorCases.get(vector);
    const entry = label === undefined ? undefined : casesByLabel.get(label);
    if (!entry) throw new Error(`missing seeded bypass case for ${vector}`);
    if (entry.status !== "review_required") throw new Error(`${label}: expected review_required, got ${entry.status}`);
    return {
      vector,
      blocked: false,
      evidenceRef: `${BYPASS_EVIDENCE}#${label}`,
      residualPath: "admission-failure-not-host-block",
    };
  });

  const bundle = renderPolicyBundle(profile, {
    command: process.execPath,
    args: [path.join(ROOT, "apps/my-pi-mcp/dist/main.js"), "--security-profile", "trusted"],
    workspace: "${workspaceFolder}",
    strictCandidate: true,
    knownUnenforcedPaths: [
      "host-native-editor",
      "alternate-mcp-server",
      "direct-git-patch",
    ],
    verificationExceptions: ["read-only verification commands"],
    bypassResults,
  });
  if (bundle.certification !== "candidate") throw new Error(`strict candidate unexpectedly certified: ${bundle.certification}`);

  const renderedConfig = bundle.mcpConfig.type === "json" ? bundle.mcpConfig.json : undefined;
  if (renderedConfig === undefined) throw new Error("OpenCode strict candidate did not render JSON config");
  const configWrite = await writeJsonThroughMyPi(client, CONFIG_PATH, renderedConfig);
  const resolvedText = run(ROOT, hostCommand(), ["debug", "config", "--pure"], { env: { ...process.env, OPENCODE_CONFIG: path.join(ROOT, CONFIG_PATH) } });
  const resolvedConfig = JSON.parse(resolvedText);
  const permission = resolvedConfig.permission ?? {};
  const permissionProof = {
    bash: permission.bash,
    edit: permission.edit,
    externalDirectory: permission.external_directory?.["*"],
    webfetch: permission.webfetch,
  };
  if (permissionProof.bash !== "deny" || permissionProof.edit !== "deny" || permissionProof.externalDirectory !== "deny" || permissionProof.webfetch !== "deny") {
    throw new Error(`OpenCode did not resolve the strict permission denies: ${JSON.stringify(permissionProof)}`);
  }

  const hostVersion = run(ROOT, hostCommand(), ["--version"]).trim();
  const evidence = {
    schemaVersion: "my-pi/track-b-strict-candidate-evidence/v1",
    measurementId: "track-b-strict-candidate-" + Date.now() + "-" + process.pid,
    measuredAt: new Date().toISOString(),
    candidate,
    profile: {
      id: profile.id,
      host: "OpenCode",
      hostVersion,
      maturity: bundle.maturity,
      certification: bundle.certification,
      configResolver: "opencode debug config --pure",
      resolvedPermission: permissionProof,
      resolvedConfigSha256: createHash("sha256").update(resolvedText).digest("hex"),
    },
    policyBundle: bundle,
    seededBypass: {
      sourceEvidence: BYPASS_EVIDENCE,
      requiredVectors: [...REQUIRED_BYPASS_VECTORS],
      cases: bypassResults,
      outcome: "all seeded mutations failed exact admission; host-side blocking was not claimed",
    },
    residualPaths: bundle.knownUnenforcedPaths,
    verdict: {
      strictCertified: false,
      reason: "host permission config resolved, but native editor, alternate MCP, and direct Git paths remain residual until host-session enforcement is empirically proven",
    },
  };
  let expectedHash;
  try {
    expectedHash = (await readThroughMyPi(client, EVIDENCE_PATH)).content_hash;
  } catch {
    expectedHash = undefined;
  }
  const written = await writeJsonThroughMyPi(client, EVIDENCE_PATH, evidence, expectedHash);
  const readback = await readThroughMyPi(client, EVIDENCE_PATH);
  if (written.content_hash !== readback.content_hash) throw new Error("strict-candidate evidence changed between write and readback");
  console.log(JSON.stringify({ ok: true, evidencePath: EVIDENCE_PATH, evidenceHash: readback.content_hash, candidate, profile: evidence.profile, residualPaths: evidence.residualPaths }, null, 2));
} finally {
  await client.close();
  await transport.close?.();
  await rm(path.join(ROOT, CONFIG_PATH), { force: true, maxRetries: 10, retryDelay: 250 });
}
