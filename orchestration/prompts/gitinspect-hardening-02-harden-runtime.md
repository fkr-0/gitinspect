Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Harden — fail-closed runtime behaviour in the browser edition, plugin host and deep links

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

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

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff: `prolong lock gitinspect`; save a namespaced checkpoint (commit hashes, checks, next risk); `prolong unlock gitinspect`. Do not dispatch another continuation unless coordinated.
