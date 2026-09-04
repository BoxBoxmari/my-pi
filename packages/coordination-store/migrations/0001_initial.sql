CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, sequence)
);

CREATE INDEX IF NOT EXISTS event_log_project_sequence_idx
  ON event_log (project_id, sequence);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  result_ref TEXT,
  result_digest TEXT,
  expires_at TEXT,
  PRIMARY KEY (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS projection_records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS projection_records_project_idx
  ON projection_records (project_id, kind);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_sessions_project_idx
  ON agent_sessions (project_id);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_dependencies (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, dependency_type)
);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scopes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_artifact_links (
  artifact_id TEXT NOT NULL,
  linked_kind TEXT NOT NULL,
  linked_id TEXT NOT NULL,
  PRIMARY KEY (artifact_id, linked_kind, linked_id)
);

CREATE TABLE IF NOT EXISTS agent_cursors (
  project_id TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_session_id)
);
