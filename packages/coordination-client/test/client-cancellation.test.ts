import { test } from "node:test";
import assert from "node:assert/strict";
import { CoordinationClient } from "@my-pi/coordination-client";

test("bounded graph reads honor caller cancellation before IPC", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new CoordinationClient({
    endpoint: { transport: "named-pipe", address: "\\\\.\\pipe\\my-pi-cancellation-test" },
  });
  await assert.rejects(
    client.graphSnapshot({ projectId: "project_test", kind: "code", signal: controller.signal }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "ERR_ABORTED",
  );
});

test("bounded provenance reads honor caller cancellation before IPC", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new CoordinationClient({
    endpoint: { transport: "named-pipe", address: "\\\\.\\pipe\\my-pi-cancellation-test" },
  });
  await assert.rejects(
    client.provenanceReport({ projectId: "project_test", worktreeId: "worktree_test", signal: controller.signal }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "ERR_ABORTED",
  );
});
