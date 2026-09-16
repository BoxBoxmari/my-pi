# GitHub Governance Required for Beta (Issue #30)

Source files document governance; they cannot enforce it. The maintainer must
apply the ruleset below via the GitHub UI or admin API — repository rulesets
currently return an empty list and branch-protection state is not verifiable
through the available integration. Until applied, this document is a
declarative record, not an enforced policy.

Objective: the existing CI, CodeQL, SBOM, audit, and release-admission work
must not be bypassable by an unprotected merge or release path. No new
workflows, no bureaucracy beyond that.

## `main` ruleset (to be enforced)

Target: branch `main`, enforcement `active`, apply to administrators as well,
bypass list: none.

- Changes enter only through pull request.
- Required approvals: **0** (solo-maintainer exception, explicit and minimal —
  requiring independent review on a solo repo adds friction without review
  value; see exceptions below).
- Require all review conversations resolved before merge.
- Require branch up to date before merge: **off** (avoid churn; CI runs per PR
  head and per merge via `pull_request` + `push` triggers).
- Block force pushes: **on**.
- Block branch deletion: **on**.
- Block branch creation outside the ruleset: off (feature branches stay cheap).

### Required status checks (stable names only)

Require exactly:

```text
ci-required
CodeQL Analysis (javascript-typescript)
```

`ci-required` is the aggregate gate in `.github/workflows/ci.yml`: it is
fail-closed over every `quality-matrix` lane (Node 24 normative on
ubuntu/windows/macos + exact-minimum `24.0.0` lane, including build, tests,
architecture/runtime-contract checks, gates, SBOM, smoke, and Production Next
local qualification). It exists so governance never depends on
matrix-generated job names — internal matrix edits must not silently drop
merge protection.

Do NOT require individual `quality (...)` matrix jobs by name.

`my-pi/admission` remains advisory (report-only) and is not a required check.

### Solo-maintainer exceptions (explicit, minimal)

1. Zero required approvals — compensated by required `ci-required` + CodeQL
   on every PR and by the release-admission pipeline.
2. Maintainer-authored PRs follow the same path: no direct pushes to `main`,
   no admin bypass.
3. Emergency fix path is the normal PR path. There is no break-glass push
   role; a broken `main` is repaired by a revert PR, also gated.

## Release authority: Model A (admitted manual release)

The release chain is already well structured and is preserved, not replaced:

```text
protected main commit
  -> prepare packs exactly one TGZ (+ SHA256)
  -> qualify lanes consume that exact TGZ (Node 24 + exact-minimum 24.0.0)
  -> admit re-verifies exact bytes, SBOM, manifest, evidence
  -> publish (workflow_dispatch, publish=true, ref refs/heads/main only)
     creates the matching v* tag + GitHub prerelease if absent
```

Governance additions:

- Publishing is allowed only when `github.event_name == 'workflow_dispatch'`,
  `inputs.publish == true`, and `github.ref == 'refs/heads/main'` (already
  enforced in `release.yml`; document here so tag protection alone is not
  mistaken for the whole policy).
- Add a `v*.*.*` tag-protection rule as defense-in-depth so tags cannot be
  moved or deleted outside the publish job.
- Keep least-privilege Actions posture: SHA-pinned actions,
  `persist-credentials: false` except publishing, minimal top-level
  permissions, `contents: write` + `id-token: write` only on the publish job,
  npm trusted publishing / OIDC (no long-lived npm tokens).

### Signed commits and tags

- Signed commits: **recommended, not required** (solo project; signatures add
  identity signal but required-signatures would add friction without
  independent verification value at this size).
- Release tags: created by the publish job via `GITHUB_TOKEN` and therefore
  unsigned. The equivalent provenance mechanism, enforced instead, is:
  exact artifact SHA binding across prepare/qualify/admit (`SHA256SUMS.txt`),
  `release-manifest.json` binding TGZ + SBOM digests to the candidate commit,
  SBOM generation/verification, and OIDC-backed npm/Registry publication.
  Revisit signed tags only if a consumer explicitly requires them.

## Merge gates vs release gates

- PR merge proves source correctness (`ci-required` + CodeQL).
- The strict release pipeline (exact-TGZ smoke, cross-lane qualification,
  admission, SBOM/manifest) runs on release qualification, not on every PR.
  Do not move full release admission into the merge path unless data shows
  merge-time regressions escaping to qualification.

## Verification checklist (configuration tests)

After applying the ruleset, prove it with a disposable PR:

1. Failing `ci-required` cannot merge.
2. Cancelled `quality-matrix` (aggregate `failure`) cannot merge.
3. Green `ci-required` + green CodeQL can merge.
4. Direct push to `main` is rejected.
5. Force push to `main` is rejected.
6. `release.yml` publish cannot run from an unprotected branch/ref
   (dispatch guard rejects non-`main` refs).

Record the verification date and results in the PR that closes Issue #30.
Do not claim Issue #30 complete on documentation alone.
