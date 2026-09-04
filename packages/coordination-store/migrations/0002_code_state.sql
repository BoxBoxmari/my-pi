CREATE TABLE IF NOT EXISTS code_entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  worktree_id TEXT,
  kind TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  path TEXT,
  symbol_kind TEXT,
  fingerprint_json TEXT,
  observed_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  UNIQUE (project_id, worktree_id, stable_key)
);

CREATE INDEX IF NOT EXISTS code_entities_project_worktree_idx
  ON code_entities (project_id, worktree_id);

CREATE INDEX IF NOT EXISTS code_entities_stable_key_idx
  ON code_entities (stable_key);

CREATE INDEX IF NOT EXISTS code_entities_path_idx
  ON code_entities (project_id, worktree_id, path);

CREATE INDEX IF NOT EXISTS code_entities_kind_idx
  ON code_entities (project_id, worktree_id, kind);

CREATE TABLE IF NOT EXISTS code_edges (
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  worktree_id TEXT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  edge_kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  provider TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, worktree_id, from_id, to_id, edge_kind, provider)
);

CREATE INDEX IF NOT EXISTS code_edges_source_idx
  ON code_edges (project_id, worktree_id, from_id);

CREATE INDEX IF NOT EXISTS code_edges_target_idx
  ON code_edges (project_id, worktree_id, to_id);

CREATE TABLE IF NOT EXISTS code_index_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  worktree_id TEXT,
  changed_path TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  entity_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS code_provider_health (
  project_id TEXT NOT NULL,
  worktree_id TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, worktree_id, provider)
);
