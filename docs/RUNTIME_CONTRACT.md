# Runtime Contract

Canonical runtime labels: `light`, `standard`, `deep`.

Forbidden active aliases: `small`, `medium`, `large`.

Generated runtime contract:

```bash
./x-harness context --contract
# compatibility: node packages/cli/dist/index.js context --contract
```

Candidate completion:

```yaml
claim:
  fix_status: fixed
verification:
  status: passed
```

Compatibility sub-agent returns may still use `result.fix_status`; runtime
completion cards use `claim.fix_status` as the canonical field.

Accepted completion:

```yaml
admission:
  outcome: success
acceptance_status: accepted
```

Withheld outcomes: `failed`, `blocked`, `skipped`, `timeout`, `error`.

## Authoritative artifact hierarchy

In multi-agent or long-running sessions, the following artifact precedence applies:

1. Source files and git diff are authoritative for implementation state.
2. `completion-card.yaml` is authoritative for completion claim state.
3. `policies/admission.yaml` is authoritative for admission policy.
4. `./x-harness verify` output is authoritative for accepted/withheld mapping in Go-native source checkouts; the TypeScript compatibility CLI remains the baseline for parity checks.
5. Chat summaries are non-authoritative.

### Adapter rule

If chat says done but `completion-card.yaml` says withheld, treat completion as withheld.
If `completion-card.yaml` claims accepted but verify output disagrees, verify output wins.

## Managed context synchronization

Validate every context entry registered in `.x-harness/managed-blocks.yaml`:

```bash
./x-harness context sync --check --registry --root . --json
```

Refresh stale registered context blocks from the canonical context:

```bash
./x-harness context sync --write --registry --root . --json
```

Registry synchronization only rewrites entries whose `type` is `context`.
Managed contract blocks remain controlled by the canonical contract generator.

<!-- BEGIN X-HARNESS MANAGED CONTRACT: runtime-contract -->
<!-- generated-by: x-harness -->
<!-- contract-hash: 17fb15a892d6764f -->

# x-harness Generated Runtime Contract

Generated from file-first source artifacts and the renderer mirror:

- policies/admission.yaml
- schemas/completion-card.schema.json
- packages/cli/src/core/contract.ts

## Canonical Rules

- Completion is admitted, not claimed.
- Verifier is read-only.
- Success is the only accepted outcome.
- Canonical tiers: light, standard, deep.
- PGV is advisory-only.

## Fix Status Fields

Completion cards use claim.fix_status as the canonical fix-status field. Subagent returns may use result.fix_status only in compatibility return payloads.

## Completion Candidate

```yaml
claim:
  fix_status: fixed
verification:
  status: passed
```

## Accepted Completion

```yaml
admission:
  outcome: success
acceptance_status: accepted
```

## Evidence Floor

- **light**: files_changed + (command_evidence or manual_rationale).
- **standard**: files_changed + command_evidence + done_checklist + prediction.
- **deep**: files_changed + command_evidence + evidence_scope_declared + untested_regions_declared + remaining_risks_declared + execution_controls_present + rollback_policy_present + done_checklist + prediction. Runtime-enforced: verification_artifacts, state.read_set, state.write_set.

## Strict Evidence Provenance

- verify --strict requires command_evidence entries to include command, exit_code, runner, and started_at for standard/deep cards.
- verify --strict requires verification_artifacts entries to include command, exit_code, runner, and started_at for standard/deep cards.

<!-- END X-HARNESS MANAGED CONTRACT: runtime-contract -->
