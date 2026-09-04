import { createHash } from "node:crypto";

/** Hash request metadata, not source content, for idempotency comparisons. */
export function digestRequest(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("idempotency input must be JSON serializable");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
