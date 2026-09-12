#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function parseArgs(args) {
  const values = { artifact: null, checksums: null, manifest: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!["--artifact", "--checksums", "--manifest"].includes(arg)) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error(`${arg} requires a path`);
    values[arg.slice(2)] = path.resolve(ROOT, value);
    index += 1;
  }
  for (const key of ["artifact", "checksums", "manifest"]) {
    if (!values[key]) throw new Error(`--${key} is required`);
  }
  return values;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function parseSingleChecksum(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error(`checksum file must contain exactly one non-empty entry; got ${lines.length}`);
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(lines[0]);
  if (!match) throw new Error("checksum entry must contain a SHA-256 digest and artifact filename");
  return { sha256: match[1], file: match[2] };
}

export function validatePublishArtifactBinding({ artifactPath, artifactSha256, checksum, manifest, policy, server, packageMetadata, releaseCommit }) {
  const errors = [];
  const artifactFile = path.basename(artifactPath);

  if (!SHA256_PATTERN.test(artifactSha256 ?? "")) errors.push("selected artifact digest is not SHA-256");
  if (checksum.file !== artifactFile) errors.push(`checksum artifact ${checksum.file} does not match selected TGZ ${artifactFile}`);
  if (checksum.sha256 !== artifactSha256) errors.push("checksum digest does not match selected TGZ bytes");

  if (manifest.releaseVersion !== policy.version) errors.push("release manifest version does not match release policy");
  if (manifest.releaseChannel !== policy.releaseChannel) errors.push("release manifest channel does not match release policy");
  if (manifest.releaseCommit !== releaseCommit) errors.push("release manifest commit does not match publish commit");
  if (manifest.artifact?.file !== artifactFile) errors.push("release manifest artifact file does not match selected TGZ");
  if (manifest.artifact?.sha256 !== artifactSha256) errors.push("release manifest artifact digest does not match selected TGZ bytes");

  if (server.version !== policy.version) errors.push("server.json version does not match release policy");
  if (packageMetadata.name !== policy.packageName) errors.push("selected TGZ package name does not match release policy");
  if (packageMetadata.version !== policy.version) errors.push("selected TGZ package version does not match release policy");
  if (packageMetadata.mcpName !== server.name) errors.push("selected TGZ mcpName does not match server.json name");

  return { ok: errors.length === 0, errors };
}

export async function verifyPublishArtifact({ artifactPath, checksumsPath, manifestPath, policy, server, packageMetadata, releaseCommit }) {
  const [artifactSha256, checksumText, manifestText] = await Promise.all([
    sha256File(artifactPath),
    readFile(checksumsPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const checksum = parseSingleChecksum(checksumText);
  const manifest = JSON.parse(manifestText);
  const validation = validatePublishArtifactBinding({ artifactPath, artifactSha256, checksum, manifest, policy, server, packageMetadata, releaseCommit });
  if (!validation.ok) throw new Error(`publish artifact binding failed: ${validation.errors.join("; ")}`);
  return { artifactFile: path.basename(artifactPath), artifactSha256, manifest, packageMetadata };
}

function readPackageMetadataFromTarball(artifactPath) {
  const text = execFileSync("tar", ["-xOf", artifactPath, "package/package.json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(text);
}

function resolvePublishCommit() {
  const candidate = process.env.RELEASE_COMMIT || process.env.GITHUB_SHA;
  if (candidate) return candidate;
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

export async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const [policy, server] = await Promise.all([
    readFile(path.join(ROOT, "release", "release-policy.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "server.json"), "utf8").then(JSON.parse),
  ]);
  const packageMetadata = readPackageMetadataFromTarball(paths.artifact);
  const result = await verifyPublishArtifact({
    artifactPath: paths.artifact,
    checksumsPath: paths.checksums,
    manifestPath: paths.manifest,
    policy,
    server,
    packageMetadata,
    releaseCommit: resolvePublishCommit(),
  });
  console.log(`Verified admitted publish artifact: ${result.artifactFile}`);
  console.log(`  sha256: ${result.artifactSha256}`);
  console.log(`  package: ${result.packageMetadata.name}@${result.packageMetadata.version}`);
  console.log(`  release commit: ${result.manifest.releaseCommit}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main().catch((err) => {
    console.error(`[PUBLISH ARTIFACT] ${err.message}`);
    process.exitCode = 1;
  });
}
