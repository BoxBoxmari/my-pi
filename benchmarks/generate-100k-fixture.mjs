#!/usr/bin/env node
/**
 * Deterministic 100k-file benchmark fixture generator.
 *
 * Generates a realistic synthetic repository containing >=100,000 files
 * across deep directory hierarchies, multiple languages (TS, JS, Python, Rust, Go),
 * gitignored trees, sensitive/secret paths, Unicode paths, binary files,
 * and deterministic search targets.
 *
 * Usage: node benchmarks/generate-100k-fixture.mjs [targetDir] [count=100000]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const TARGET_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.tmpdir(), "ccr-100k-fixture");
const TOTAL_FILES = parseInt(process.argv[3] ?? "100000", 10);
const SEED = 133742;

// Simple deterministic pseudo-random number generator (LCG)
class DeterministicRandom {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick(arr) {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

const rng = new DeterministicRandom(SEED);

const EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
  ".json", ".md", ".yaml", ".toml", ".txt", ".bin",
];

const MODULE_NAMES = [
  "auth", "user", "order", "payment", "inventory", "shipping", "analytics",
  "billing", "notification", "catalog", "search", "gateway", "indexer",
  "storage", "cache", "queue", "worker", "reporter", "logger", "config",
];

const SUBDIRS = [
  "src", "test", "internal", "pkg", "components", "utils", "handlers",
  "models", "services", "controllers",
];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TEMPLATES = {
  ".ts": (id, mod) => `// Module ${mod} - Component #${id}
export interface ${capitalize(mod)}Entity${id} {
  id: string;
  name: string;
  revision: number;
}
export function process${capitalize(mod)}${id}(item: ${capitalize(mod)}Entity${id}): string {
  return \`processed-\${item.name}-\${item.id}\`;
}
`,
  ".js": (id, mod) => `// Module ${mod} JS #${id}
function handle${capitalize(mod)}${id}(data) {
  return { id: ${id}, mod: "${mod}", time: Date.now() };
}
module.exports = { handle${capitalize(mod)}${id} };
`,
  ".py": (id, mod) => `# Module ${mod} Py #${id}
class ${capitalize(mod)}Handler${id}:
    def run(self) -> dict:
        return {"status": "ok", "module": "${mod}", "index": ${id}}
`,
  ".rs": (id, mod) => `// Module ${mod} Rust #${id}
pub struct ${capitalize(mod)}Unit${id} { pub id: u64 }
`,
  ".go": (id, mod) => `// Module ${mod} Go #${id}
package ${mod}
type ${capitalize(mod)}Record${id} struct { ID int64 }
`,
  ".json": (id, mod) => `{"module":"${mod}","id":${id},"active":true}\n`,
  ".md": (id, mod) => `# Doc ${mod} ${id}\n\nBenchmark fixture documentation.\n`,
  ".yaml": (id, mod) => `module: ${mod}\nid: ${id}\n`,
  ".toml": (id, mod) => `[pkg]\nname = "${mod}-${id}"\n`,
  ".txt": (id, mod) => `Log entry ${id} for module ${mod}\n`,
  ".bin": (id) => `BIN\0\0\x01\x02\x03\x04${String.fromCharCode(id % 256)}\0\0RAW`,
};

export async function generate100kFixture(targetDir = TARGET_DIR, count = TOTAL_FILES) {
  console.log(`[100k-generator] Generating ${count} deterministic files in: ${targetDir}`);
  const t0 = performance.now();

  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(targetDir, { recursive: true });

  // 1. Root configuration & Gitignore
  await fs.writeFile(path.join(targetDir, ".gitignore"), `
node_modules/
dist/
target/
.cache/
*.log
temp/
.env*
`, "utf8");

  await fs.writeFile(path.join(targetDir, "package.json"), JSON.stringify({
    name: "ccr-100k-benchmark-repo",
    version: "1.0.0",
    private: true,
  }, null, 2), "utf8");

  // 2. Sensitive paths (to verify policy security during search/grep)
  const secretsDir = path.join(targetDir, ".aws");
  await fs.mkdir(secretsDir, { recursive: true });
  await fs.writeFile(path.join(secretsDir, "credentials"), "[default]\naws_access_key_id = AKIA_BENCHMARK_FAKE\naws_secret_access_key = SECRET_KEY\n", "utf8");
  await fs.writeFile(path.join(targetDir, ".env"), "DATABASE_URL=postgres://user:pass@localhost:5432/bench\nAPI_KEY=SECRET_123\n", "utf8");

  // 3. Unicode paths
  const unicodeDir = path.join(targetDir, "src", "i18n", "日本語");
  await fs.mkdir(unicodeDir, { recursive: true });
  await fs.writeFile(path.join(unicodeDir, "メッセージ.json"), JSON.stringify({ greeting: "こんにちは世界" }, null, 2), "utf8");
  await fs.writeFile(path.join(targetDir, "src", "tést_fïle.ts"), "export const utf8 = 'café & naïve';\n", "utf8");

  // 4. Deterministic search needles at known locations
  const needlePath1 = path.join(targetDir, "src", "target_unique_needle.ts");
  await fs.writeFile(needlePath1, `// CCR_BENCHMARK_TARGET_UNIQUE_NEEDLE_A17\nexport const benchmarkTarget = 42;\n`, "utf8");

  // 5. Build compact directory hierarchy (5 pkgs * 10 mods * 4 subdirs = 200 directories)
  const numPackages = 5;
  const numModules = 10;
  const numSubdirs = 4;
  const directories = [];

  for (let p = 0; p < numPackages; p++) {
    for (let m = 0; m < numModules; m++) {
      for (let s = 0; s < numSubdirs; s++) {
        const d = path.join(targetDir, `pkg_${p}`, `mod_${m}`, SUBDIRS[s]);
        directories.push(d);
      }
    }
  }

  for (const d of directories) {
    await fs.mkdir(d, { recursive: true });
  }

  const batchSize = 500;
  let createdCount = 4; // root files created above

  for (let i = 0; i < count; i += batchSize) {
    const currentBatch = Math.min(batchSize, count - i);
    const promises = [];

    for (let j = 0; j < currentBatch; j++) {
      const fileId = i + j + 1;
      const targetDirChoice = directories[fileId % directories.length];
      const ext = EXTENSIONS[fileId % EXTENSIONS.length];
      const mod = MODULE_NAMES[fileId % MODULE_NAMES.length];
      const filename = `file_${fileId}${ext}`;
      const filePath = path.join(targetDirChoice, filename);

      const templateFn = TEMPLATES[ext] ?? TEMPLATES[".txt"];
      const content = templateFn(fileId, mod);

      promises.push(fs.writeFile(filePath, content, "utf8"));
    }

    await Promise.all(promises);
    createdCount += currentBatch;

    if (createdCount % 20000 === 0 || createdCount >= count) {
      console.log(`[100k-generator] Written ${createdCount} / ${count} files...`);
    }
  }

  const elapsedMs = Math.round(performance.now() - t0);
  console.log(`[100k-generator] Completed! Created ${createdCount} files in ${directories.length} directories in ${elapsedMs}ms.`);

  return {
    targetDir,
    totalFiles: createdCount,
    totalDirs: directories.length,
    elapsedMs,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  generate100kFixture().catch((err) => {
    console.error("Generator failed:", err);
    process.exit(1);
  });
}
