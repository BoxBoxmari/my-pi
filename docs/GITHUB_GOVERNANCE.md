# GitHub Governance Required for Beta

These controls belong to GitHub repository settings. Source files can document
them, but cannot enforce branch protection or security-scanning settings by
themselves.

## `main` branch protection

Configure a ruleset for `main` with the following requirements:

- Changes must enter through a pull request; require at least one approving review.
- Dismiss stale approvals after new commits and require all review conversations to be resolved.
- Require the branch to be up to date before merge.
- Require these CI checks: `quality (ubuntu-latest, node 24)`, `quality (ubuntu-latest, node 22)`, `quality (windows-latest, node 24)`, and `quality (macos-latest, node 24)`.
- Require the CodeQL check once CodeQL is enabled as a required repository check.
- Require the strict release admission job for release tags, including runtime-boundary performance evidence.
- Block force-pushes and branch deletion. Apply the rules to administrators as well.

The exact check names are generated from the matrix in `.github/workflows/ci.yml`;
update the ruleset if the matrix changes.

## Repository security settings

- Enable secret scanning and push protection when available for the repository plan.
- Allow Dependabot security updates for npm, Cargo, and GitHub Actions.
- Restrict GitHub Actions to approved actions where organizational policy permits.
- Protect release tags (`v*.*.*`) and require an environment approval before any future registry publication job.
- Keep the default `GITHUB_TOKEN` permission at read-only and grant write permissions only to the step that needs them.

## Release workflow requirements

The release workflow must pin third-party actions to full commit SHAs, keep
dependency audits fail-closed, and attach the tested artifact, SBOM, checksum,
and release manifest to the same candidate commit. A release is not accepted
merely because a local build or test run is green.
