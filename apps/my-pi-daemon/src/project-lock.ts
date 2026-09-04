import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

interface LockRecord {
  token: string;
  pid: number;
  startedAt: string;
}

const LOCK_READ_ATTEMPTS = 5;
const LOCK_READ_DELAY_MS = 5;

export class ProjectAlreadyRunningError extends Error {
  readonly code = "ERR_DAEMON_ALREADY_RUNNING";

  constructor(message = "a my-pi daemon already owns this project") {
    super(message);
    this.name = "ProjectAlreadyRunningError";
  }
}

export interface ProjectLock {
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type LockReadState =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; record: LockRecord };

async function readLockState(lockPath: string): Promise<LockReadState> {
  for (let attempt = 0; attempt < LOCK_READ_ATTEMPTS; attempt++) {
    try {
      const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockRecord>;
      if (typeof value.token !== "string" || typeof value.pid !== "number" || typeof value.startedAt !== "string") return { kind: "invalid" };
      return { kind: "valid", record: { token: value.token, pid: value.pid, startedAt: value.startedAt } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      if (attempt + 1 < LOCK_READ_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, LOCK_READ_DELAY_MS));
    }
  }
  return { kind: "invalid" };
}

async function readLock(lockPath: string): Promise<LockRecord | undefined> {
  const state = await readLockState(lockPath);
  return state.kind === "valid" ? state.record : undefined;
}

export async function acquireProjectLock(lockPath: string): Promise<ProjectLock> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const record: LockRecord = { token, pid: process.pid, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(record), "utf8");
      } finally {
        await handle.close();
      }
      return {
        path: lockPath,
        token,
        async release() {
          const current = await readLock(lockPath);
          if (current?.token === token) await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readLockState(lockPath);
      if (existing.kind === "valid") {
        if (processIsAlive(existing.record.pid)) throw new ProjectAlreadyRunningError();
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (existing.kind === "missing") continue;
      throw new ProjectAlreadyRunningError("lock record is unreadable; refusing stale cleanup");
    }
  }

  throw new ProjectAlreadyRunningError("could not acquire the project daemon lock after stale-lock cleanup");
}
