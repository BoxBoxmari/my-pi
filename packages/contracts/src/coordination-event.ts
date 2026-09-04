import type { ActorRef } from "./principal.js";
import type { EventId, ProjectId } from "./ids.js";
import type { SchemaVersion } from "./schema-version.js";

export const COORDINATION_EVENT_TYPES = [
  "ProjectOpened",
  "AgentJoined",
  "AgentHeartbeat",
  "AgentExpired",
  "WorkItemCreated",
  "WorkItemClaimed",
  "WorkItemBlocked",
  "WorkItemUnblocked",
  "WorkItemImplementationComplete",
  "WorkItemAwaitingEvaluation",
  "WorkItemEvaluationAccepted",
  "WorkItemEvaluationRejected",
  "WorkItemEvaluationReviewRequired",
  "WorkItemCompleted",
  "IntentDeclared",
  "IntentSuperseded",
  "ScopeDeclared",
  "ScopeReleased",
  "ContextPublished",
  "ContractChanged",
  "CodeGraphUpdated",
  "ImpactDetected",
  "ChangeProposed",
  "ChangeApplied",
  "ChangeRejected",
  "VerificationRecorded",
  "EvaluationRequested",
  "EvaluationStarted",
  "EvaluationResultRecorded",
  "EvaluationCompleted",
  "AcceptanceDecided",
  "FeedbackIssued",
  "RetryRecommended",
  "RetryScheduled",
  "RetryExhausted",
] as const;

export type CoordinationEventType = (typeof COORDINATION_EVENT_TYPES)[number];

export interface CoordinationEvent<T = unknown> {
  schemaVersion: SchemaVersion;
  projectId: ProjectId;
  sequence: bigint;
  eventId: EventId;
  eventType: string;
  occurredAt: string;
  actor: ActorRef;
  correlationId?: string;
  causationId?: string;
  payload: T;
}
