CREATE TABLE IF NOT EXISTS evaluation_specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  spec_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, id, version)
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  spec_id TEXT NOT NULL,
  spec_version INTEGER NOT NULL,
  target_state_ref TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS evaluation_runs_work_item_idx
  ON evaluation_runs (project_id, work_item_id, state);

CREATE TABLE IF NOT EXISTS evaluation_results (
  run_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  provider_result_id TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (run_id, criterion_id, provider_result_id)
);

CREATE TABLE IF NOT EXISTS evaluation_evidence (
  run_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  target_state_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (run_id, criterion_id, evidence_digest)
);

CREATE TABLE IF NOT EXISTS acceptance_decisions (
  run_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_packets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retry_cycles (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS retry_cycles_active_idx
  ON retry_cycles (run_id, state);
