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

The repository workflow grants `id-token: write` only to the publish job. The job upgrades to a supported npm CLI before `npm publish`, so publication uses short-lived GitHub OIDC credentials rather than a stored npm write token.

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

`server.json`, the npm package version, and `release/release-policy.json` are checked by `scripts/verify-release.mjs` before admission.

## Release operation

After this one-time npm trust relationship exists:

1. Merge the release candidate to `main` only after CI passes.
2. Open GitHub Actions → `Release Qualification & Publishing` → **Run workflow**.
3. Select branch `main`.
4. Set release channel to `alpha`.
5. Set `publish=true`.
6. Run the workflow.

The workflow qualifies the candidate, publishes the admitted npm tarball if absent, publishes and verifies the Official MCP Registry version if absent, then creates the matching Git tag and GitHub prerelease.

The publication path is idempotent: a retry must verify an already-published npm version instead of attempting to overwrite it.

## Failure handling

- **npm OIDC rejected:** verify the trusted publisher owner/repository/workflow filename and confirm the workflow is running on a GitHub-hosted runner.
- **npm version already exists:** the workflow accepts it only if the version and `mcpName` match the candidate.
- **MCP Registry ownership rejected:** verify the published npm version contains the matching `mcpName`; retry after Registry-side cache/transient issues rather than republishing npm.
- **GitHub release creation fails:** rerun the workflow. The npm and Registry steps are idempotent, and the tag/release step verifies existing state before creating anything.
