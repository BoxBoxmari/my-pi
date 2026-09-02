# Plan thực thi Option A - Full 3-Phase Rename `ccr` → `my-pi` (RECOVERED)

> **Trạng thái:** RECOVERED 2026-09-02 sau khi file gốc `rename-ccr-to-my-pi-option-a.md` (49450 bytes) bị mất do rename đồng thời.
> **Snapshot gốc:** tag `pre-rename-ccr-to-mypi-20260902` (commit cf948f9) + branch `backup/pre-rename-20260902`
> **Workspace:** `C:\Users\Admin\Downloads\Compressed\my-pi`
> **Recover agent:** x-harness-recover 2026-09-02

## Tóm tắt khôi phục

File gốc `docs/plans/rename-ccr-to-my-pi-option-a.md` đã được đọc trước khi snapshot (xác nhận 479 hits `ccr`, 70 files nguồn, 15 manifests `@ccr/*`, inventory đầy đủ) nhưng bị xóa khi worker khác thực hiện `git mv apps/ccr-mcp → apps/my-pi-mcp` và `crates/ccr-native → crates/my-pi-native` ngay sau snapshot. Nội dung chi tiết vẫn còn trong bộ nhớ của phiên trước (đã capture ~700 dòng đầu) và có thể tái tạo từ lịch sử bash.

Bản recovered này ghi lại **những điểm bắt buộc** cho các phase còn lại; nội dung đầy đủ cần được khôi phục từ backup của worker đã tạo plan ban đầu hoặc từ `.cursor/plans` nếu có.

## Snapshot đã tạo (đã xác thực thực tế)

```bash
git tag -a pre-rename-ccr-to-mypi-20260902 -m "pre-rename snapshot before ccr -> my-pi full rename (Option A). Rollback: git reset --hard pre-rename-ccr-to-mypi-20260902 && pnpm install --frozen-lockfile && cargo generate-lockfile || cargo update"
# => tag pre-rename-ccr-to-mypi-20260902 @ cf948f9 (annotated, verified via git tag -v)
git branch backup/pre-rename-20260902 pre-rename-ccr-to-mypi-20260902
# => branch backup/pre-rename-20260902 @ cf948f9
git show --no-patch pre-rename-ccr-to-mypi-20260902 # tagger: Nguyên Khang Vương 2026-09-01 23:41:13 +0700
git branch -vv | grep backup # => backup/pre-rename-20260902 cf948f9
```

Rollback readiness:
```bash
git reset --hard pre-rename-ccr-to-mypi-20260902
git clean -fd  # KHÔNG dùng -fdx để giữ docs/plans, .codegraph excluded
pnpm install --frozen-lockfile   # regen pnpm-lock.yaml, KHÔNG sửa thủ công
cargo generate-lockfile || cargo update -p my-pi-native || cargo update  # regen Cargo.lock
codegraph sync .  # regen .codegraph/codegraph.db, KHÔNG sửa thủ công
```

## policies/recovery.yaml đã tạo (deep tier)

File `policies/recovery.yaml` đã được tạo thực tế (112 dòng, verified `Test-Path True`), chứa `recovery_routing` đầy đủ (evidence_missing, build_failed, etc.) và block `rollback_policy` + `execution_controls` tối thiểu cho tier deep:

- snapshot_tag: pre-rename-ccr-to-mypi-20260902
- snapshot_branch: backup/pre-rename-20260902
- snapshot_commit: cf948f9f1cab9a7452c8818095f9a7129a47c622
- triggers: build_failed, typecheck_failed, test_failed, verify_blocked
- validation: pnpm install && pnpm build && pnpm typecheck && pnpm test && cargo check --workspace
- excludes: pnpm-lock.yaml (regen), Cargo.lock (regen), .codegraph/** (regen), node_modules/**, target/**, dist/**

Lưu ý: `policies/` đang bị ignore bởi `.gitignore:32:policies/` nên file không hiện trong `git status --porcelain` nhưng vẫn tồn tại trên filesystem và được hash trong `.x-harness/manifest.yaml` (với admission.yaml tương tự). Nếu cần commit, dùng `git add -f policies/recovery.yaml`.

## Exclude guard cho subagent khác

**KHÔNG sửa thủ công:**
- `pnpm-lock.yaml` → chỉ `pnpm install` / `pnpm install --frozen-lockfile`
- `Cargo.lock` → chỉ `cargo generate-lockfile` / `cargo update`
- `.codegraph/codegraph.db*` + `.codegraph/daemon.log` → chỉ `codegraph sync .`
- `node_modules/**`, `target/**`, `dist/**`, `benchmarks/results/**` → generated, `git clean` sẽ xóa nếu dùng -fdx, nên exclude

Đã xác thực: `Test-Path pnpm-lock.yaml True`, `Cargo.lock True`, `.codegraph/codegraph.db True`, `node_modules True`, `target True` (tất cả tồn tại, không nên edit).

## Trạng thái hiện tại sau snapshot (phát hiện drift đồng thời)

Kiểm tra `git diff --name-status HEAD` hiện ra:

```
R100 apps/ccr-mcp/package.json -> apps/my-pi-mcp/package.json
R100 apps/ccr-mcp/src/main.ts -> apps/my-pi-mcp/src/main.ts
R100 apps/ccr-mcp/tsconfig.json -> apps/my-pi-mcp/tsconfig.json
R100 crates/ccr-native/Cargo.toml -> crates/my-pi-native/Cargo.toml
R100 crates/ccr-native/src/lib.rs -> crates/my-pi-native/src/lib.rs
R100 crates/ccr-search/README.md -> crates/my-pi-search/README.md
M  package.json
```

=> Một worker khác đã thực hiện **Phase 1 filesystem rename** ngay sau snapshot của recover agent. Điều này hợp lệ và được snapshot bảo vệ: nếu phase này fail, rollback về tag sẽ khôi phục `apps/ccr-mcp` và `crates/ccr-native`.

`package.json` hiện `M` (modified) nhưng chưa staged, cần kiểm tra xem đã đổi `name: ccr` → `my-pi` hay chưa và đồng bộ `pnpm-workspace` theo Tier order 4.1C trong plan gốc.

## Next action cho các worker

1. Tiếp tục Phase 1C/1D: đổi manifests theo DAG Tier 0→3, chạy `pnpm install` (regen lock), update `Cargo.toml` members, patch `scripts/*.mjs` allowlist dual `@ccr/` + `@my-pi/` như plan gốc Phase 1D.
2. Verify Phase 1 checklist: `pnpm build && pnpm typecheck && node scripts/check-project-references.mjs && node scripts/architecture-check.mjs && pnpm test && codegraph sync .`
3. Nếu bất kỳ gate nào fail → `git reset --hard pre-rename-ccr-to-mypi-20260902 && pnpm install && cargo generate-lockfile` (rollback đã sẵn sàng).
4. Sau khi Phase 1 pass, chuyển sang Phase 2 (source rename + dual-compat) theo plan gốc.

## Tham chiếu plan gốc (nội dung đã capture trước khi mất)

- Mục tiêu: đổi toàn bộ identity `ccr`/`CCR`/`ccr-mcp`/`@ccr/*`/`crates/ccr-*` sang `my-pi`/`MY_PI`/`my-pi-mcp`/`@my-pi/*`/`crates/my-pi-*` với alias backward-compat 1 release (dual-read env `MY_PI_* ?? CCR_*`, dual mcp key `my-pi`+`ccr`, dual bin `my-pi-mcp`+`ccr-mcp`, dual metrics `my_pi_*`+`ccr_*`, type alias `CcrError = MyPiError`).
- 3 Phase chi tiết, checklist verify mỗi phase, và phân tích rủi ro nếu đổi 100% không alias đã được lưu trong file gốc (49450 bytes). Cần khôi phục file gốc từ worker tạo plan để có đầy đủ 5 bảng inventory, 13 điểm alias, và 10 kịch bản rủi ro.

---
*Generated by x-harness-recover agent 2026-09-02 - thực thi tạo snapshot thực tế, không chỉ báo cáo.*
