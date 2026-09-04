import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

interface LockRecord {
  token: string;
  pid: number;
  startedAt: string;
}

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

async function readLock(lockPath: string): Promise<LockRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockRecord>;
    if (typeof value.token !== "string" || typeof value.pid !== "number" || typeof value.startedAt !== "string") return undefined;
    return { token: value.token, pid: value.pid, startedAt: value.startedAt };
  } catch {
    return undefined;
  }
}

export async function acquireProjectLock(lockPath: string): Promise<ProjectLock> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const record: LockRecord = { token, pid: process.pid, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
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
      const existing = await readLock(lockPath);
      if (existing && processIsAlive(existing.pid)) throw new ProjectAlreadyRunningError();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  throw new ProjectAlreadyRunningError("could not acquire the project daemon lock after stale-lock cleanup");
}
