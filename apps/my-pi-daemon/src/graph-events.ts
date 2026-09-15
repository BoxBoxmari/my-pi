export interface GraphEventsScopeInput {
  kind?: string;
  mode?: string;
  worktreeId?: string;
  subjectId?: string;
  eventTypeByKind: Record<string, readonly string[]>;
}

export interface GraphEventsScopeDegraded {
  provider: "graph-events";
  reason: string;
}

export interface GraphEventsSubjectFilter {
  subjectId: string;
  keysByEventType: Readonly<Record<string, readonly string[]>>;
}

export type GraphEventsScopeResult =
  | { ok: false; error: "invalid-mode" | "invalid-kind" }
  | {
      ok: true;
      eventTypeIn?: readonly string[];
      payloadWorktreeFilter?: string;
      payloadSubjectFilter?: GraphEventsSubjectFilter;
      degraded?: GraphEventsScopeDegraded;
    };

const GRAPH_EVENT_MODES = new Set(["live", "replay"]);

/**
 * Payload fields carrying the graph subject id, per graph kind and event type,
 * enumerated from the emitting runtimes (impact subject = intent id; lineage
 * subject = proposal/receipt id). An empty list means the event type carries no
 * subject-bearing field and must be kept with a degraded marker.
 */
export const GRAPH_EVENT_SUBJECT_KEYS_BY_KIND: Readonly<
  Record<"impact" | "lineage", Readonly<Record<string, readonly string[]>>>
> = {
  impact: {
    ImpactDetected: ["intentId", "subject"],
    ScopeDeclared: [],
    ScopeReleased: [],
  },
  lineage: {
    ContextPublished: ["workItemId"],
    ChangeProposed: ["id", "workItemId", "intentId"],
    ChangeApplied: ["id", "proposalId"],
    ChangePartiallyApplied: ["id", "proposalId"],
    ChangeRejected: ["id", "proposalId"],
    VerificationRecorded: [],
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Pure payload post-filter mirroring the worktree filter. An event is kept when
 * any configured subject key on its payload equals the subject id. Events with
 * no configured key list, or whose payload has no present string subject field,
 * are kept and reported via `filteringIncomplete` so the caller degrades rather
 * than silently dropping or silently unscoping the stream.
 */
export function applyPayloadSubjectFilter<T extends { eventType: string; payload?: unknown }>(
  events: readonly T[],
  filter: GraphEventsSubjectFilter,
): { events: T[]; filteringIncomplete: boolean } {
  const kept: T[] = [];
  let filteringIncomplete = false;
  for (const event of events) {
    const keys = filter.keysByEventType[event.eventType];
    const payload = asRecord(event.payload);
    if (keys === undefined || keys.length === 0 || payload === undefined) {
      filteringIncomplete = true;
      kept.push(event);
      continue;
    }
    let matched = false;
    let present = false;
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string") {
        present = true;
        if (value === filter.subjectId) {
          matched = true;
          break;
        }
      }
    }
    if (matched) kept.push(event);
    else if (!present) {
      filteringIncomplete = true;
      kept.push(event);
    }
  }
  return { events: kept, filteringIncomplete };
}

function degradedOf(reasons: string[]): GraphEventsScopeDegraded | undefined {
  return reasons.length === 0 ? undefined : { provider: "graph-events", reason: reasons.join("; ") };
}

/**
 * Pure scope resolver for the daemon graph_events handler. Validates mode/kind,
 * derives the event-type allowlist filter for the store, and declares degraded
 * scopes that cannot be fully filtered server-side.
 */
export function resolveGraphEventsScope(input: GraphEventsScopeInput): GraphEventsScopeResult {
  if (input.mode !== undefined && !GRAPH_EVENT_MODES.has(input.mode)) {
    return { ok: false, error: "invalid-mode" };
  }
  const subjectIgnoredReason =
    input.subjectId !== undefined && (input.kind === undefined || input.kind === "work" || input.kind === "code")
      ? `subjectId ignored for kind=${input.kind ?? "all"}: subject scoping applies to impact/lineage only`
      : undefined;

  if (input.kind === undefined) {
    const reasons = ["kind omitted: returning the full project event stream"];
    if (subjectIgnoredReason !== undefined) reasons.push(subjectIgnoredReason);
    return { ok: true, degraded: { provider: "graph-events", reason: reasons.join("; ") } };
  }

  const eventTypeIn = Object.hasOwn(input.eventTypeByKind, input.kind) ? input.eventTypeByKind[input.kind] : undefined;
  if (eventTypeIn === undefined || !Array.isArray(eventTypeIn) || eventTypeIn.length === 0) {
    return { ok: false, error: "invalid-kind" };
  }

  if (input.kind === "code") {
    const reasons: string[] = [];
    if (input.worktreeId === undefined) reasons.push("code events require worktreeId");
    if (subjectIgnoredReason !== undefined) reasons.push(subjectIgnoredReason);
    const degraded = degradedOf(reasons);
    return {
      ok: true,
      eventTypeIn,
      ...(input.worktreeId === undefined ? {} : { payloadWorktreeFilter: input.worktreeId }),
      ...(degraded === undefined ? {} : { degraded }),
    };
  }

  if (input.kind === "impact" || input.kind === "lineage") {
    if (input.subjectId === undefined) {
      return { ok: true, eventTypeIn, degraded: { provider: "graph-events", reason: `${input.kind} events require subjectId` } };
    }
    return {
      ok: true,
      eventTypeIn,
      payloadSubjectFilter: { subjectId: input.subjectId, keysByEventType: GRAPH_EVENT_SUBJECT_KEYS_BY_KIND[input.kind] },
    };
  }

  const degraded = degradedOf(subjectIgnoredReason === undefined ? [] : [subjectIgnoredReason]);
  return { ok: true, eventTypeIn, ...(degraded === undefined ? {} : { degraded }) };
}
