/**
 * @my-pi/testing — test helpers for fixtures, temp workspaces, and MCP harnesses.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tempWorkspace(files: Record<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "my-pi-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await writeFile(full, content, "utf8");
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
