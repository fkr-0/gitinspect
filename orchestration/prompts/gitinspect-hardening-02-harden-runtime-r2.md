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

## Resume context (round 2) — read before acting

This is a continuation of OCP task `GITINSPECT-HARDEN-02-RUNTIME-20261008`, which stopped with status `blocked`. Its checkpoint is `.ws-bridge/agent-checkpoints/GITINSPECT-HARDEN-02-RUNTIME-20261008.json`; read it and `git log` first and **do not redo work already committed**.

Previous summary: Partial hardening committed 0df3ffe; integration blocked by concurrent wasmMain claim, baseline typecheck/lint failures; full requested acceptance not complete.

Prior artifacts: 0df3ffe, apps/gitinspect/src/inspection/inspectionExport.ts, apps/gitinspect/src/components/RuntimeErrorBoundary.tsx, apps/gitinspect/wasm.html, apps/gitinspect/src-tauri/tauri.conf.json

Remaining work recorded by the previous round:
- Coordinate wasmMain.tsx with HARDEN-04 before wiring browser boundary.
- Add per-feature error boundaries, WebGL recovery and reduced-motion behavior.
- Complete adversarial Rust plugin tests and typed bounds for search/deep-link/descriptors.
- Collect failure screenshots, fix/coordinate global check failures, rerun complete gates.

Environment is now healthy: `main` is green in CI at ef572bc+ (typecheck, lint, 227 tests, rustfmt on all four Rust crates), the shared `node_modules` was rebuilt from the frozen lockfile with a single R3F copy, and the earlier TypeScript/Biome/rustfmt blockers were fixed. If a gate fails, first check whether it also fails on a clean frozen-lockfile install before reporting it as a blocker. Local commits are preferred, but finish by pushing nothing: the coordinator pushes after CI review.
