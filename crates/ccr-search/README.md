# crates/ccr-search — intentionally not created

Per Plan v1.1 §9 and §19.3, this crate is only needed if OMP grep.rs cannot be reused cleanly and a minimal owned Rust search crate is required. The current V1 uses the pure Node fallback (@ccr/search NodeFallbackSearchBackend) which satisfies the required corpus, so no Rust search crate is needed. This placeholder satisfies the structure check.

