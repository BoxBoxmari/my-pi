# Contributing to my-pi

Thank you for your interest in contributing to **my-pi**!

## Development Setup

Requirements:
- Node.js `>=22.6.0`
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
4. **Adhere to Code of Conduct:** Be respectful and constructive.