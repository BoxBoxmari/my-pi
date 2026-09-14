# Graph scale benchmark

This document records the bounded graph fixture measurement required by Track C T033. It is
contract and scale evidence for the local graph model and portal response path; it is not PN6 or
PN8 product-value evidence and it does not authorize promotion.

## Fixture and measurement contract

- Fixtures contain 500, 1,000, and 2,000 code-graph nodes.
- Each node has two deterministic directed edges on a 2:1 edge-to-node density.
- Node and edge identifiers, labels, source paths, evidence references, and attributes are
  deterministic and contain no private or absolute paths.
- The test measures normalized snapshot construction, render-ready HTML generation, and the
  loopback portal JSON response. The HTML measurement is serialization/render preparation; it is
  not a browser paint or Core Web Vitals measurement.
- The portal response limit is 2 MiB and the per-operation measurement budget is 5,000 ms.
- The test asserts exact node/edge counts, `truncated: false`, response-size bounds, and HTTP 200
  for all three fixtures.

## Reproduction

Run from the repository root after the normal build so the test imports the current `dist/`
artifacts:

```powershell
pnpm build
node --test --test-concurrency=1 --experimental-strip-types apps/my-pi-ui/test/graph-scale.test.ts
```

The test prints one `graph-scale-evidence` JSON record containing the measured bytes, durations,
and SHA-256 digest for each normalized fixture. Measurements are host- and run-specific; the
digest and counts are the stable identity, while durations are observational bounds for the
recorded Windows run.

## Recorded Windows run

Recorded on 2026-09-13 in the current my-pi workspace through the official my-pi MCP runtime.
The candidate worktree was dirty, so this record remains local scale evidence and is not a clean
candidate attestation.

| Nodes | Edges | Snapshot bytes | HTML bytes | Portal bytes | Build ms | Render ms | Response ms | Fixture SHA-256 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 500 | 1,000 | 324,345 | 335,104 | 324,345 | 9.902 | 1.088 | 27.540 | `e3b7deac596d9e0bb45ff201bf641c9e35f9b5c8ecb54b55399186f7d7812731` |
| 1,000 | 2,000 | 653,847 | 664,606 | 653,847 | 11.411 | 1.952 | 31.627 | `6eb460536ecbd9e8488f426ad85d2e1cb1b1ae7820a82b179e754d1da5c46a6f` |
| 2,000 | 4,000 | 1,310,847 | 1,321,606 | 1,310,847 | 27.131 | 4.548 | 23.823 | `8b4393fe790e70178e2e0d3da206b49a9385e56e4680fea3c2c10d8216a794ed` |
