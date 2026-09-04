import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { err } from "@my-pi/contracts";
import { normalizeCoordinationStoreError } from "./errors.js";

export const CURRENT_SCHEMA_VERSION = 5;

const MIGRATION_FILES = [
  { version: 1, url: new URL("../migrations/0001_initial.sql", import.meta.url) },
  { version: 2, url: new URL("../migrations/0002_code_state.sql", import.meta.url) },
  { version: 3, url: new URL("../migrations/0003_evaluation.sql", import.meta.url) },
  { version: 4, url: new URL("../migrations/0004_audit.sql", import.meta.url) },
  { version: 5, url: new URL("../migrations/0005_evaluation_query_indexes.sql", import.meta.url) },
];

export async function applyMigrations(db: DatabaseSync): Promise<void> {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version?: unknown }>;
    const applied = new Set(rows.map((row) => Number(row.version)).filter(Number.isSafeInteger));
    if ([...applied].some((version) => version > CURRENT_SCHEMA_VERSION)) {
      throw err.schemaMigrationRequired("database schema is newer than this runtime");
    }

    for (const migration of MIGRATION_FILES) {
      if (applied.has(migration.version)) continue;
      const sql = await readFile(fileURLToPath(migration.url), "utf8");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    throw normalizeCoordinationStoreError(error);
  }
}
