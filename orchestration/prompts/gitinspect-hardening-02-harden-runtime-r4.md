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

## Round 4 — scope for THIS dispatch only (overrides broader objectives above)

Earlier rounds stopped partial because they attempted too much or collided on shared files. Deliver **one verified slice** and stop. First read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log`; do not redo committed work. State at dispatch: `main` (6d56dd9) is green in CI and locally: typecheck, lint, 233 tests, rustfmt on all four Rust crates, clippy -D warnings on Rust 1.98.0; the shared `node_modules` has a single R3F copy; the shared Rust 1.98.0 toolchain was repaired and verified (rustc, cargo, rustfmt, clippy, wasm32 target). If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint named after your OCP task id (for example GITINSPECT-HARDEN-02-RUNTIME-R4-20261008.json), be explicit about what is done versus not, and commit locally; the coordinator pushes after CI review. Do not edit files owned by another round-4 lane.

Exclusive ownership this round:
- Upgrade lane: `rust-toolchain.toml`, `.github/**`, root `package.json`/`pnpm-workspace.yaml`. It must NOT edit any Cargo.toml or Cargo.lock.
- WASM lane: `crates/gitinspect-model/**` and `crates/gitinspect-wasm/**` including their Cargo.toml/Cargo.lock, plus `docs/WEBASSEMBLY.md`. Only this lane touches those manifests.
- Sanitize lane: `packages/contracts/**`, `apps/gitinspect/src/{domain,drilldown,inspection}/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`.
- Runtime lane: `crates/gitinspect-core/src/plugins.rs`, `crates/gitinspect-core/tests/**`, and viewport components under `apps/gitinspect/src/components/` (GraphScene, ViewportCameraBridge and their tests). It must NOT edit `wasmMain.tsx` or anything under `inspection/`.
- Nobody edits mutation modules or `CHANGELOG.md`.

### Slice: plugin-host adversarial tests, and WebGL loss/recovery in the viewport
1. In `crates/gitinspect-core`, add adversarial tests for the plugin host around the symlink-escape fix: symlinked manifest files and parent directories, `..` and absolute paths, case and Unicode-normalisation tricks, oversized and deeply nested JSON, pathological patterns, and attempts to raise scan limits through config. Fix any real hole you find, preferring canonicalise-then-verify-prefix over string checks.
2. In the viewport components, handle WebGL context loss and restoration (show a recoverable state, restore the scene) and honour `prefers-reduced-motion`, with unit tests and a failure-UI description in your checkpoint.
Wiring error boundaries into `wasmMain.tsx` is deliberately NOT in this round (the WASM lane may touch it later).
