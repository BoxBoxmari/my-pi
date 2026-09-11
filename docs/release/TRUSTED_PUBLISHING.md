# Trusted Publishing Bootstrap

This document records the one-time account-level configuration required before `my-pi` can publish releases without long-lived write tokens.

## npm Trusted Publisher

Configure the public npm package `@koonwang03/my-pi` on npmjs.com with a GitHub Actions trusted publisher using exactly:

| Field | Value |
| --- | --- |
| GitHub owner | `BoxBoxmari` |
| Repository | `my-pi` |
| Workflow filename | `release.yml` |
| Environment | leave unset unless the workflow is later moved behind a protected GitHub Environment |
| Allowed action | enable direct `npm publish` |

The explicit direct-publish permission matters for trusted-publisher configurations created after 2026-09-03: new configurations default to staged publishing unless direct `npm publish` is also allowed.

The repository workflow grants `id-token: write` only to the publish job. The job uses Node 24 and upgrades to npm `11.19.1` before `npm publish`, satisfying npm Trusted Publishing's current OIDC runtime requirements while avoiding a stored npm write token.

If you prefer CLI bootstrap instead of the npmjs.com form, run this from an npm-authenticated workstation with account-level 2FA enabled:

```bash
npm trust github @koonwang03/my-pi \
  --repo BoxBoxmari/my-pi \
  --file release.yml \
  --allow-publish \
  --yes
```

Do not add a long-lived `NPM_TOKEN` merely to bypass missing trusted-publisher configuration. If OIDC publication fails, correct the npm trust relationship first.

## Official MCP Registry

No persistent MCP Registry token is required for the GitHub-owned namespace used by this project. The release workflow authenticates with:

```bash
mcp-publisher login github-oidc
```

The registered server identity is:

```text
io.github.BoxBoxmari/my-pi
```

The npm package must expose the matching field:

```json
{
  "mcpName": "io.github.BoxBoxmari/my-pi"
}
```

`server.json`, the npm package version, and `release/release-policy.json` are checked by `scripts/verify-release.mjs` before admission. The pinned `mcp-publisher` also validates `server.json` before the irreversible npm publication step.

## Release operation

After this one-time npm trust relationship exists:

1. Merge the release candidate to `main` only after CI passes.
2. Open GitHub Actions → `Release Qualification & Publishing` → **Run workflow**.
3. Select branch `main`.
4. Set release channel to `alpha`.
5. Set `publish=true`.
6. Run the workflow.

The workflow qualifies the candidate, validates the MCP Registry manifest, publishes the admitted npm tarball if absent, publishes and verifies the Official MCP Registry version if absent, then creates the matching Git tag and GitHub prerelease.

The publication path is idempotent: a retry must verify an already-published npm version instead of attempting to overwrite it.

## Failure handling

- **npm OIDC rejected:** verify the trusted publisher owner/repository/workflow filename, confirm direct `npm publish` is allowed, and confirm the workflow is running on a GitHub-hosted runner.
- **npm version already exists:** the workflow accepts it only if the version and `mcpName` match the candidate.
- **MCP manifest validation fails:** fix `server.json` before publishing npm; do not bypass validation.
- **MCP Registry ownership rejected:** verify the published npm version contains the matching `mcpName`; retry after Registry-side cache/transient issues rather than republishing npm.
- **GitHub release creation fails:** rerun the workflow. The npm and Registry steps are idempotent, and the tag/release step verifies existing state before creating anything.
