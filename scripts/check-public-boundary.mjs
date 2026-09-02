#!/usr/bin/env node
/**
 * Public Repository Boundary Verifier (Workstream F, Batch 4).
 *
 * Verifies that no internal scratch files, agent metadata, completion cards,
 * credentials, or unapproved artifacts are tracked in the Git repository index.
 *
 * Usage: node scripts/check-public-boundary.mjs
 */
import { execSync } from "node:child_process";
import process from "node:process";

const FORBIDDEN_PATTERNS = [
  // Agent & Harness metadata
  /^\.agent\//i,
  /^\.agents\//i,
  /^\.agt\//i,
  /^\.knowns\//i,
  /^\.x-harness\//i,
  /^\.codegraph\//i,
  /^\.claude\//i,
  /^\.codex\//i,
  /^\.grok\//i,
  /^completion-card\.ya?ml$/i,
  /^STACK\.md$/i,
  /^X_HARNESS\.md$/i,

  // Internal plans and notes
  /^docs\/plans\//i,
  /^docs\/MIGRATION_CCR_TO_MY_PI\.md$/i,

  // Secrets & credentials
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,

  // Raw logs & transient binaries
  /^evidence\/.*\.log$/i,
  /\.tgz$/i,
  /\.node$/i,
];

async function checkBoundary() {
  console.log("=== CHECK PUBLIC REPOSITORY BOUNDARY ===");

  let trackedFiles = [];
  try {
    const raw = execSync("git ls-files", { encoding: "utf8" });
    trackedFiles = raw.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
  } catch (err) {
    console.error("[BOUNDARY] Failed to execute git ls-files:", err.message);
    process.exit(1);
  }

  console.log(`Inspecting ${trackedFiles.length} tracked files in git index...`);

  const violations = [];
  for (const file of trackedFiles) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(file)) {
        violations.push({ file, pattern: pattern.toString() });
        break;
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ [BOUNDARY VIOLATION] ${violations.length} forbidden file(s) are tracked in git:`);
    for (const v of violations) {
      console.error(`  - ${v.file} (matched: ${v.pattern})`);
    }
    console.error(`\nPlease untrack these files with 'git rm --cached <file>' and update .gitignore.`);
    process.exit(1);
  }

  console.log("✓ [BOUNDARY PASS] Zero forbidden or sensitive files tracked in git index.\n");
}

await checkBoundary();