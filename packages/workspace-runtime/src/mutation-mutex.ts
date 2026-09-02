import type { WorkspaceId } from "@my-pi/contracts";

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
