# G0 — N-API Platform Spike

Status: **BLOCKED** (external environment).

## Contract (from v1.1 §29)
Release-blocking matrix: **Windows x64 + Node 24**, **macOS arm64 + Node 24**, **Linux x64 + Node 24**. Spike verifies compile, package, install, load `.node`, sync/async call, cancellation bridge, Rust→JS error mapping, panic/fatal documentation, version sentinel, prebuilt loader resolution.

## Evidence recorded
- `Cargo.toml` / `crates/ccr-native` scaffold exists (empty dependency surface, `cdylib`).
- Local toolchain: `cargo 1.90.0`, `rustc 1.90.0`, `node v26.7.0`, Windows x64.
- **No `.node` was built or loaded.** napi-rs dependency intentionally not added until the spike is executed on the blocking matrix.

## Why not executed here
- Only a single platform (Windows x64) is available; macOS arm64 and Linux x64 cannot be run from this machine.
- The installed Node is v26, not the normative v24; a load test here would not validate the release target.

## Decision / condition
- The native architecture is **not accepted** until the spike runs on the three blocking platform/runtime pairs.
- Native search backend is therefore not wired; G1/G2 run on the **pure Node fallback** (correctness-compatible, `degraded=true`), which is a frozen invariant (A14) and does not block the Node foundation.

## Exit artifact
This report. `G0_NATIVE_SPIKE_REPORT.md` is a placeholder until execution.
