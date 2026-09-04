export const EVALUATION_EVENT_TYPES = [
  "EvaluationSpecRegistered",
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

export type EvaluationEventType = (typeof EVALUATION_EVENT_TYPES)[number];
