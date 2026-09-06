import type { WorkspaceId } from "@my-pi/contracts";

/**
 * Intra-process async mutex, one FIFO queue per workspace id.
 *
 * Scope: this mutex serializes concurrent `mutatePath` calls WITHIN a single
 * Node.js process only. It provides NO cross-process (multi-process / multi-
 * host) mutual exclusion — two processes have separate `locks` maps and will
 * not block each other.
 *
 * Cross-process safety relies on compare-and-swap (CAS) at publication time:
 * `assertPrecondition` in `@my-pi/change-runtime` (admission.ts, re-checked
 * inside `publishOne` after revalidation) rejects a stale writer with
 * `ERR_STALE_RESOURCE` instead of silently overwriting the winner's bytes.
 * The no-clobber create path (`atomicCreateNoReplace`, hard-link publish)
 * is likewise atomic across processes. Never rely on this mutex alone for
 * correctness against external writers; always go through the CAS publication
 * path.
 */
interface LockEntry {
  tail: Promise<void>;
  release: () => void;
}

const locks = new Map<WorkspaceId, LockEntry>();

export async function withWorkspaceLock<T>(workspaceId: WorkspaceId, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(workspaceId);
  const prevTail = prev ? prev.tail : Promise.resolve();

  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const entry: LockEntry = { tail: prevTail.then(() => next), release };
  locks.set(workspaceId, entry);

  await prevTail;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(workspaceId) === entry) locks.delete(workspaceId);
  }
}

export function lockCount(): number {
  return locks.size;
}
