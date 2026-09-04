CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_ref TEXT,
  agent_session_id TEXT,
  operation TEXT NOT NULL,
  policy_decision TEXT,
  resource_ref TEXT,
  change_ref TEXT,
  result_code TEXT,
  request_id TEXT,
  correlation_id TEXT,
  classification TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_project_time_idx
  ON audit_events (project_id, occurred_at DESC);
