Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Harden — fail-closed runtime behaviour in the browser edition, plugin host and deep links

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Objective

Make failure states explicit, bounded and recoverable instead of blank pages or silent degradation.

- Add top-level and per-feature React error boundaries (viewport, inspector, search) that show an actionable message, keep the rest of the app alive, and expose a "copy diagnostics" action containing only non-sensitive facts (version, WASM API version, capabilities, error message).
- Handle WebGL unavailable, context loss/restoration, WASM load/instantiate failure, and `prefers-reduced-motion`; never fall back silently to a fake success state.
- Bound every input: deep-link (`0.3.x` share links) parsing, inspector JSON export size, search query length, drill-down depth, and number of retained descriptors. Reject over-limit input with a typed error, never truncate silently.
- Rust plugin host (`crates/gitinspect-core/src/plugins.rs`): the symlink-escape fix just landed. Add adversarial tests for it: symlinked manifest files, symlinked parent dirs, `..` and absolute paths, case-folding and Unicode-normalisation tricks, oversized/deeply nested JSON, regex/glob blow-up, TOCTOU between check and read, and config attempts to raise scan limits. Prefer open-by-dirfd / canonicalise-then-verify-prefix over string checks.
- Add a Content-Security-Policy for the Pages edition and the Tauri webview; document any unavoidable `wasm-unsafe-eval`.

## Evidence

Tests per bullet (vitest + cargo), a short table of limits introduced with their defaults, and screenshots of each failure UI. `cargo fmt --check`, `clippy -D warnings`, `pnpm typecheck`, `pnpm lint`, `pnpm test` green.

## Owned scope

`apps/gitinspect/src/{state,inspection,components}/**` (new error-boundary files and limits modules only), `apps/gitinspect/wasm.html` + wasm entry, `crates/gitinspect-core/src/plugins.rs` and `crates/gitinspect-core/tests/**`, CSP in `apps/gitinspect/src-tauri/tauri.conf.json`. Not `vite*.ts`/lockfile/`pages.yml` (the duplicate-R3F crash is already fixed in 34e8096; keep `scripts/check-single-r3f.mjs` and `scripts/wasm-smoke.mjs` passing) or Tauri capability files (prompt 03).

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff (the legacy `prolong lock/unlock` commands are retired and do nothing): write a namespaced checkpoint to `.ws-bridge/agent-checkpoints/` named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R2-20261008.json) (status, summary, commit hashes, checks run, artifacts, nextSteps, followUpTasks) and submit the typed phase result for your OCP task through the ws-bridge workflow tools. Say plainly if the work is partial or blocked; never report completion you have not verified. Do not dispatch another continuation unless coordinated.

## Round 7 — scope for THIS dispatch only (overrides broader objectives above)

Deliver **one verified slice** and stop. First read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log`; do not redo committed work. State at dispatch: `main` (c104a4d) is green in GitHub CI (typecheck, lint, tests, fmt and clippy on the pinned Rust 1.98.0 via `rust-toolchain.toml`, a model/wasm matrix, Pages build with the single-R3F guard and browser smoke test) and in a clean frozen-lockfile checkout. If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint file named after your OCP task id under `.ws-bridge/agent-checkpoints/`, say plainly what is done versus not, and commit locally; the coordinator pushes after CI review. Do not edit files owned by another lane. Ignore uncommitted `Cargo.lock` churn in core and Tauri: do not commit it.

DISK RULES (about 15 GB free; the Tauri crate's build output alone is 10 GB):
- Do not build, check, clippy or test the Tauri crate (`apps/gitinspect/src-tauri`) this round.
- Never run `cargo clean` (lanes share target directories); prefer per-crate `cargo check`/`cargo clippy`/`cargo test --manifest-path`.
- Before a Rust gate run `df -h /`. If less than 5 GB is free, stop, write your checkpoint explaining that, and do nothing destructive.

Exclusive ownership this round:
- WASM lane: `crates/gitinspect-model/**` and `crates/gitinspect-wasm/**` including manifests, `crates/gitinspect-core/examples/**` (golden JSON generation only), `docs/WEBASSEMBLY.md`.
- Runtime lane: `crates/gitinspect-core/src/plugins.rs`, `crates/gitinspect-core/tests/**`, and `scripts/webgl-recovery-smoke.mjs` (new). It must not edit root `package.json`.
- Sanitize lane: `packages/contracts/**` and `apps/gitinspect/src/{domain,drilldown,inspection}/**` (JavaScript/TypeScript only, no Rust, no src-tauri).
- Upgrade lane: `.github/**` only. No Cargo or package manifests, no lockfiles.
- Nobody edits mutation modules or `CHANGELOG.md`.

### Slice: TOCTOU-safe plugin manifest reads, and a real-browser WebGL recovery check
1. In `crates/gitinspect-core/src/plugins.rs`, make the manifest read TOCTOU-safe: open the file once, verify on the open handle (canonical path stays inside `.gitinspect/plugins/`, regular file, size cap) and read from that same handle, so a path swapped for a symlink between check and read cannot escape. Add deterministic tests that swap the path between the check and the read (use an injectable hook or a seam in the read function) and fix any hole found.
2. Add `scripts/webgl-recovery-smoke.mjs`: serve a built `apps/gitinspect/dist-wasm` (see `scripts/wasm-smoke.mjs` for the harness pattern, using the pinned `playwright-core` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`), force `WEBGL_lose_context.loseContext()` on the canvas, assert the recoverable overlay appears with no uncaught exception, call `restoreContext()`, assert the overlay disappears and the scene is drawing again, and save before/during/after screenshots. Document the exact command in your checkpoint; do not wire it into CI (the upgrade lane owns `.github`).
