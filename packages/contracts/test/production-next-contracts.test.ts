import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentSessionId,
  createChangeProposalId,
  createChangeReceiptId,
  createCodeEntityId,
  createContextArtifactId,
  createEvaluationRunId,
  createEvaluationSpecId,
  createEventId,
  createFeedbackPacketId,
  createIntentId,
  createPrincipalId,
  createProjectId,
  createRepositoryId,
  createScopeId,
  createWorkItemId,
  createWorktreeId,
  type AgentSession,
  type Project,
  type Repository,
  type Worktree,
} from "@my-pi/contracts";

test("Production Next identity IDs are opaque, distinct, and path-independent", () => {
  const ids = [
    ["project", createProjectId],
    ["repo", createRepositoryId],
    ["worktree", createWorktreeId],
    ["session", createAgentSessionId],
    ["work", createWorkItemId],
    ["intent", createIntentId],
    ["scope", createScopeId],
    ["entity", createCodeEntityId],
    ["event", createEventId],
    ["context", createContextArtifactId],
    ["proposal", createChangeProposalId],
    ["receipt", createChangeReceiptId],
    ["evalspec", createEvaluationSpecId],
    ["evalrun", createEvaluationRunId],
    ["feedback", createFeedbackPacketId],
    ["principal", createPrincipalId],
  ].map(([prefix, create]) => {
    const id = (create as () => string)();
    assert.match(id, new RegExp(`^${prefix}_[0-9a-f]{12}$`));
    assert.ok(!id.includes("/"));
    return id;
  });

  assert.equal(new Set(ids).size, ids.length);
});

test("Production Next identity contracts serialize without transport dependencies", () => {
  const project: Project = {
    id: createProjectId(),
    schemaVersion: "1",
    displayName: "my-pi",
    createdAt: "2026-09-04T00:00:00.000Z",
    policyRef: { id: "local-default", version: "1" },
  };
  const repository: Repository = {
    id: createRepositoryId(),
    projectId: project.id,
    vcs: "git",
    canonicalIdentity: "git:local:my-pi",
  };
  const worktree: Worktree = {
    id: createWorktreeId(),
    repositoryId: repository.id,
    root: "C:/work/my-pi",
    branch: "main",
    observedAt: "2026-09-04T00:00:00.000Z",
  };
  const session: AgentSession = {
    id: createAgentSessionId(),
    projectId: project.id,
    worktreeId: worktree.id,
    host: "test-host",
    status: "active",
    joinedAt: "2026-09-04T00:00:00.000Z",
    heartbeatAt: "2026-09-04T00:00:00.000Z",
  };

  assert.deepEqual(JSON.parse(JSON.stringify({ project, repository, worktree, session })), {
    project,
    repository,
    worktree,
    session,
  });
});
