INSERT OR IGNORE INTO evaluation_specs (id, project_id, version, spec_digest, payload_json, created_at)
SELECT json_extract(payload_json, '$.id'), project_id, json_extract(payload_json, '$.version'), json_extract(payload_json, '$.specDigest'), payload_json, json_extract(payload_json, '$.createdAt')
FROM projection_records
WHERE kind = 'evaluation_spec' AND project_id IS NOT NULL;

INSERT OR IGNORE INTO evaluation_runs (id, project_id, spec_id, spec_version, target_state_ref, work_item_id, attempt, state, payload_json, updated_at)
SELECT json_extract(payload_json, '$.id'), project_id, json_extract(payload_json, '$.specId'), json_extract(payload_json, '$.specVersion'), json_extract(payload_json, '$.repositoryStateRef'), json_extract(payload_json, '$.workItemId'), json_extract(payload_json, '$.attempt'), json_extract(payload_json, '$.state'), payload_json, updated_at
FROM projection_records
WHERE kind = 'evaluation_run' AND project_id IS NOT NULL;

INSERT OR IGNORE INTO evaluation_results (run_id, criterion_id, provider_result_id, result_digest, payload_json, recorded_at)
SELECT json_extract(payload_json, '$.runId'), json_extract(payload_json, '$.criterionId'), json_extract(payload_json, '$.providerResultId'), json_extract(payload_json, '$.resultDigest'), payload_json, json_extract(payload_json, '$.recordedAt')
FROM projection_records
WHERE kind = 'evaluation_result' AND project_id IS NOT NULL;

INSERT OR IGNORE INTO acceptance_decisions (run_id, decision, decision_digest, payload_json, decided_at)
SELECT json_extract(payload_json, '$.runId'), json_extract(payload_json, '$.decision'), json_extract(payload_json, '$.decisionDigest'), payload_json, updated_at
FROM projection_records
WHERE kind = 'evaluation_decision' AND project_id IS NOT NULL;

INSERT OR IGNORE INTO feedback_packets (id, run_id, payload_json, created_at)
SELECT json_extract(payload_json, '$.id'), json_extract(payload_json, '$.runId'), payload_json, updated_at
FROM projection_records
WHERE kind = 'feedback_packet' AND project_id IS NOT NULL;

INSERT OR IGNORE INTO retry_cycles (id, run_id, attempt, max_attempts, state, payload_json, updated_at)
SELECT json_extract(payload_json, '$.id'), json_extract(payload_json, '$.runId'), json_extract(payload_json, '$.attempt'), json_extract(payload_json, '$.maxAttempts'), json_extract(payload_json, '$.state'), payload_json, updated_at
FROM projection_records
WHERE kind = 'retry_cycle' AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evaluation_results_run_criterion_idx
  ON evaluation_results (run_id, criterion_id, provider_result_id);

CREATE INDEX IF NOT EXISTS evaluation_evidence_run_idx
  ON evaluation_evidence (run_id, criterion_id, evidence_digest);

CREATE INDEX IF NOT EXISTS acceptance_decisions_run_idx
  ON acceptance_decisions (run_id, decision);

CREATE INDEX IF NOT EXISTS feedback_packets_run_idx
  ON feedback_packets (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS retry_cycles_run_attempt_idx
  ON retry_cycles (run_id, attempt DESC, updated_at DESC);
