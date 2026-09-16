import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("node:sqlite runtime smoke defines the supported floor", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("create table t (id integer primary key, value text)");
    db.prepare("insert into t(value) values (?)").run("ok");
    const row = db.prepare("select value from t where id = 1").get();
    assert.equal(row?.value, "ok");
  } finally {
    db.close();
  }
});

test("runtime contract guard passes (engines/types/CI/release parity)", async () => {
  try {
    await execFileAsync(process.execPath, ["scripts/check-runtime-contract.mjs"], { cwd: "." });
  } catch (error) {
    assert.fail(`check-runtime-contract.mjs failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
});
