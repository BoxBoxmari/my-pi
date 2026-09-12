import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { verifyPublishArtifact } from "../../scripts/verify-publish-artifact.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const VERIFY_SCRIPT = path.join(ROOT, "scripts", "verify-publish-artifact.mjs");
const canonicalReleaseCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
  cwd: ROOT,
  encoding: "utf8",
}).trim().toLowerCase();

const policy = {
  packageName: "@koonwang03/my-pi",
  version: "0.1.0-alpha.2",
  releaseChannel: "alpha",
};
const server = {
  name: "io.github.BoxBoxmari/my-pi",
  version: policy.version,
};
const packageMetadata = {
  name: policy.packageName,
  version: policy.version,
  mcpName: server.name,
};
const releaseCommit = "0123456789abcdef0123456789abcdef01234567";

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-publish-binding-"));
  const artifactPath = path.join(dir, "koonwang03-my-pi-0.1.0-alpha.2.tgz");
  const checksumsPath = path.join(dir, "SHA256SUMS.txt");
  const manifestPath = path.join(dir, "release-manifest.json");
  const artifactBytes = "qualified release artifact bytes";
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  await writeFile(artifactPath, artifactBytes, "utf8");
  await writeFile(checksumsPath, `${artifactSha256}  ${path.basename(artifactPath)}\n`, "utf8");
  const manifest = {
    schemaVersion: 1,
    releaseVersion: policy.version,
    releaseChannel: policy.releaseChannel,
    releaseCommit,
    artifact: {
      file: path.basename(artifactPath),
      sha256: artifactSha256,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dir, artifactPath, checksumsPath, manifestPath, artifactSha256, manifest };
}

async function realTarballFixture(metadata = packageMetadata) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "my-pi-publish-tarball-"));
  const packageDir = path.join(dir, "package");
  const artifactPath = path.join(dir, "koonwang03-my-pi-0.1.0-alpha.2.tgz");
  const checksumsPath = path.join(dir, "SHA256SUMS.txt");
  const manifestPath = path.join(dir, "release-manifest.json");

  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await execFileAsync("tar", ["-czf", artifactPath, "-C", dir, "package"]);

  const artifactSha256 = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  await writeFile(checksumsPath, `${artifactSha256}  ${path.basename(artifactPath)}\n`, "utf8");
  const manifest = {
    schemaVersion: 1,
    releaseVersion: policy.version,
    releaseChannel: policy.releaseChannel,
    releaseCommit: canonicalReleaseCommit,
    artifact: {
      file: path.basename(artifactPath),
      sha256: artifactSha256,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dir, artifactPath, checksumsPath, manifestPath, artifactSha256, manifest };
}

function verify(paths, overrides = {}) {
  return verifyPublishArtifact({
    artifactPath: paths.artifactPath,
    checksumsPath: paths.checksumsPath,
    manifestPath: paths.manifestPath,
    policy,
    server,
    packageMetadata,
    releaseCommit,
    ...overrides,
  });
}

test("publish artifact binding accepts one fully admitted artifact identity", async () => {
  const paths = await fixture();
  try {
    const result = await verify(paths);
    assert.equal(result.artifactFile, path.basename(paths.artifactPath));
    assert.equal(result.artifactSha256, paths.artifactSha256);
    assert.equal(result.packageMetadata.version, policy.version);
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("publish artifact binding rejects a checksum pair that contradicts the admitted manifest", async () => {
  const paths = await fixture();
  try {
    const contradictory = {
      ...paths.manifest,
      artifact: {
        file: "different-artifact.tgz",
        sha256: "f".repeat(64),
      },
    };
    await writeFile(paths.manifestPath, `${JSON.stringify(contradictory, null, 2)}\n`, "utf8");

    await assert.rejects(
      verify(paths),
      /release manifest artifact file does not match selected TGZ.*release manifest artifact digest does not match selected TGZ bytes/,
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("publish artifact binding rejects injected package identity when it diverges", async () => {
  const paths = await fixture();
  try {
    await assert.rejects(
      verify(paths, {
        packageMetadata: {
          ...packageMetadata,
          version: "0.1.0-evil",
          mcpName: "io.github.BoxBoxmari/not-my-pi",
        },
      }),
      /selected TGZ package version does not match release policy.*selected TGZ mcpName does not match server.json name/,
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("publish artifact CLI extracts and accepts package identity from a real TGZ", async () => {
  const paths = await realTarballFixture();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT, "--artifact", paths.artifactPath, "--checksums", paths.checksumsPath, "--manifest", paths.manifestPath],
      {
        cwd: ROOT,
        env: { ...process.env, RELEASE_COMMIT: canonicalReleaseCommit },
      },
    );
    assert.match(stdout, /Verified admitted publish artifact:/);
    assert.match(stdout, /package: @koonwang03\/my-pi@0\.1\.0-alpha\.2/);
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("publish artifact CLI rejects divergent package identity extracted from a real TGZ", async () => {
  const paths = await realTarballFixture({
    ...packageMetadata,
    version: "0.1.0-evil",
    mcpName: "io.github.BoxBoxmari/not-my-pi",
  });
  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [VERIFY_SCRIPT, "--artifact", paths.artifactPath, "--checksums", paths.checksumsPath, "--manifest", paths.manifestPath],
        {
          cwd: ROOT,
          env: { ...process.env, RELEASE_COMMIT: canonicalReleaseCommit },
        },
      ),
      (err) => {
        const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
        assert.match(output, /selected TGZ package version does not match release policy/);
        assert.match(output, /selected TGZ mcpName does not match server\.json name/);
        return true;
      },
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});

test("publish artifact binding rejects a checksum filename that is not the selected TGZ", async () => {
  const paths = await fixture();
  try {
    await writeFile(paths.checksumsPath, `${paths.artifactSha256}  other.tgz\n`, "utf8");
    await assert.rejects(
      verify(paths),
      /checksum artifact other\.tgz does not match selected TGZ/,
    );
  } finally {
    await rm(paths.dir, { recursive: true, force: true });
  }
});
