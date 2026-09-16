import { discoverProjectIdentity } from "@my-pi/coordination-client";
import type { JoinInput } from "@my-pi/coordination-runtime";
import type { SqliteCoordinationStore } from "@my-pi/coordination-store";
import { err, type ProjectId, type Repository, type RepositoryId, type Worktree, type WorktreeId } from "@my-pi/contracts";
import { WorkspaceRuntime } from "@my-pi/workspace-runtime";
import type { DaemonConfig } from "./config.js";
import type { CodeStateManager } from "./code-state-manager.js";
import { objectParam, requiredString, samePath } from "./request-params.js";

export interface CodeStateRegistrationInput {
  projectId: ProjectId;
  repositoryId: RepositoryId;
  worktreeId: WorktreeId;
  repositoryIdentity: string;
  root: string;
}

export type ScheduleCodeStateRegistration = (input: CodeStateRegistrationInput) => void;

export async function verifyJoinInput(params: Record<string, unknown>, expectedProjectId: ProjectId, daemonProject: DaemonConfig["project"], store: SqliteCoordinationStore, testMode: boolean): Promise<{ project?: JoinInput["project"]; repository: Repository; worktree: Worktree }> {
  const repository = objectParam(params, "repository") as unknown as Repository;
  const worktree = objectParam(params, "worktree") as unknown as Worktree;
  const requestedRoot = requiredString(worktree as unknown as Record<string, unknown>, "root");
  if (repository.projectId !== expectedProjectId) throw err.projectNotFound("repository does not belong to this daemon project");
  if (worktree.repositoryId !== repository.id) throw err.invalidArgument("worktree does not belong to the supplied repository");
  const identity = await discoverProjectIdentity(requestedRoot, { allowNonGit: testMode });
  if (!testMode && identity.canonicalIdentity !== daemonProject.canonicalIdentity) throw err.projectNotFound("worktree repository identity does not match the daemon project");
  const existing = await store.getProjection<Worktree>("worktree", worktree.id);
  if (existing && (!samePath(existing.root, identity.root) || existing.repositoryId !== repository.id)) throw err.workItemConflict("worktree id is already bound to a different canonical root");
  const verifiedRepository: Repository = { ...repository, projectId: expectedProjectId, canonicalIdentity: identity.canonicalIdentity };
  const verifiedWorktree: Worktree = {
    ...worktree,
    root: identity.root,
    repositoryId: verifiedRepository.id,
    ...(identity.head === undefined ? {} : { head: identity.head }),
    ...(identity.branch === undefined ? {} : { branch: identity.branch }),
    observedAt: new Date().toISOString(),
  };
  const project = params.project === undefined ? undefined : objectParam(params, "project");
  return {
    ...(project === undefined ? {} : { project: { displayName: typeof project.displayName === "string" ? project.displayName : undefined, policyRef: project.policyRef as never } }),
    repository: verifiedRepository,
    worktree: verifiedWorktree,
  };
}

export interface CodeStateScheduler {
  schedule: ScheduleCodeStateRegistration;
  pending: Set<Promise<void>>;
  drain(): Promise<void>;
}

/**
 * Fire-and-forget worktree registration with failure telemetry.
 * Preserves the stable-bootstrap invariant: each role joins and schedules
 * readiness tracking without blocking the join response; failures are
 * recorded as events rather than failing the join.
 */
export function createCodeStateScheduler(store: SqliteCoordinationStore, codeStateManager: CodeStateManager): CodeStateScheduler {
  const pendingCodeStateRegistrations = new Set<Promise<void>>();
  const schedule: ScheduleCodeStateRegistration = (input) => {
    const registration = (async () => {
      const worktreeRuntime = new WorkspaceRuntime();
      await worktreeRuntime.open({ root: input.root });
      await codeStateManager.register({
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        worktreeId: input.worktreeId,
        repositoryIdentity: input.repositoryIdentity,
        root: input.root,
        signal: new AbortController().signal,
        resolveReadPath: (filePath) => worktreeRuntime.pathPolicy.resolveForRead(worktreeRuntime.workspaceOrThrow, filePath, { allowMissing: true }),
      });
    })();
    let tracked: Promise<void>;
    tracked = registration.catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[my-pi-daemon] code-state registration failed worktree=${input.worktreeId}: ${message}`);
      await store.appendEvent({
        projectId: input.projectId,
        eventType: "CodeStateRegistrationFailed",
        actor: { kind: "system", name: "code-state-manager" },
        payload: { worktreeId: input.worktreeId, message },
      }).catch(() => undefined);
    }).finally(() => {
      pendingCodeStateRegistrations.delete(tracked);
    });
    pendingCodeStateRegistrations.add(tracked);
  };
  return {
    schedule,
    pending: pendingCodeStateRegistrations,
    drain: () => Promise.allSettled([...pendingCodeStateRegistrations]).then(() => undefined),
  };
}
