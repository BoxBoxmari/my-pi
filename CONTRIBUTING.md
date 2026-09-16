# Contributing to my-pi

Thank you for your interest in contributing to **my-pi**!

## Development Setup

Requirements:
- Node.js `>=24.0.0` (Node 24 is normative; see `scripts/check-runtime-contract.mjs`)
- pnpm `>=10.0.0`
- Rust toolchain (2021 edition)

```bash
# Clone and install dependencies
git clone https://github.com/BoxBoxmari/my-pi.git
cd my-pi
pnpm install

# Build all packages
pnpm build

# Run unit and integration tests
pnpm test

# Run PR smoke verification
pnpm test:smoke
```

## Pull Request Guidelines

1. **Keep diffs focused:** One concern per PR.
2. **Deterministic tests:** All changes to core capabilities must be backed by automated tests.
3. **Verify gates:** Run `pnpm verify` before opening a pull request.
4. **Merge policy:** All changes enter `main` through a pull request gated by `ci-required` and CodeQL. Direct pushes, force pushes, and branch deletion on `main` are blocked. See `docs/GITHUB_GOVERNANCE.md` for the full governance model.
5. **Test contract:** Critical invariants are listed in `test-contract/invariants.json`. If you remove a proof file, rename a verification command, or drop a CI gate, `pnpm check:contract` fails until the manifest is intentionally updated in the same PR. See `docs/TEST_CONTRACT.md`.
5. **Adhere to Code of Conduct:** Be respectful and constructive.