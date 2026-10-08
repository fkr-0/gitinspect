Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Sanitize — treat everything read from a repository as hostile

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Objective

Commit messages, author/committer names and emails, ref/tag/branch names, file paths, submodule URLs, `.gitinspect.yml` and plugin manifests all come from the repository under inspection. Audit every path from `gitinspect-core` -> Tauri command -> contracts -> React/three.js label -> inspector -> deep link -> JSON export, and make hostile content inert.

- Define one sanitisation module for display strings: strip or visibly escape C0/C1 control chars, ANSI escape sequences, bidi overrides/isolates (Trojan-source), zero-width and homoglyph-confusable path separators; cap length with an explicit ellipsis marker; never use `dangerouslySetInnerHTML`, `innerHTML` or markdown/HTML rendering of repo text. Verify three.js text/label generation does not evaluate content.
- Share links and `gitinspect-inspection/v1` export: validate against a strict schema on import/parse, reject unknown fields, and ensure exported JSON cannot be coerced into executable content (CSV/formula injection if any CSV exists).
- Path handling: reject or normalise `..`, absolute, drive-letter, UNC, NUL and over-long paths in every Rust command argument; ensure all Tauri commands re-validate arguments on the Rust side regardless of UI checks.
- Tauri: minimise `capabilities/` permissions and the filesystem/shell/opener scope to what the read-only flow needs; document each remaining permission.
- Check logs and error messages for leakage of absolute home paths or repository content.

## Evidence

A fixture repository (generated in a repo-local temp dir) with malicious refs, commit messages, author names, filenames and plugin manifests; tests proving each renders inert in the DOM, labels, deep links and exports. List of Tauri permissions before/after.

## Owned scope

`apps/gitinspect/src/{domain,services,drilldown}/**`, `packages/contracts/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`, new sanitisation module + tests, `crates/gitinspect-core/src/{repository,diff,model}.rs` argument validation only. Coordinate on `plugins.rs` with the hardening prompt (02): do not edit it.

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff (the legacy `prolong lock/unlock` commands are retired and do nothing): write a namespaced checkpoint to `.ws-bridge/agent-checkpoints/` named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R2-20261008.json) (status, summary, commit hashes, checks run, artifacts, nextSteps, followUpTasks) and submit the typed phase result for your OCP task through the ws-bridge workflow tools. Say plainly if the work is partial or blocked; never report completion you have not verified. Do not dispatch another continuation unless coordinated.

## Round 5 — scope for THIS dispatch only (overrides broader objectives above)

Deliver **one verified slice** and stop. First read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log`; do not redo committed work. State at dispatch: `main` (8395b2c) is green in CI and in a clean frozen-lockfile checkout on the pinned Rust 1.98.0 (`rust-toolchain.toml` selects it automatically); the shared `node_modules` has one R3F copy. If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint named after your OCP task id (for example GITINSPECT-HARDEN-03-SANITIZE-R5-20261008.json), say plainly what is done versus not, and commit locally; the coordinator pushes after CI review. Do not edit files owned by another lane. Ignore any uncommitted `Cargo.lock` churn in core and Tauri: do not commit it.

DISK RULES (free space is tight, about 19 GB, and the Tauri build output alone is 10 GB):
- Do not build, check, clippy or test the Tauri crate (`apps/gitinspect/src-tauri`) unless you are the sanitize lane and your slice requires it.
- Never run `cargo clean` (several lanes share the same target directories at once); prefer per-crate `cargo check`/`cargo clippy`/`cargo test --manifest-path`.
- Before starting a Rust gate run `df -h /`. If less than 5 GB is free, stop, write your checkpoint explaining that, and do nothing destructive.

Exclusive ownership this round:
- Upgrade lane: `.github/**`, `rust-toolchain.toml`, root `package.json`/`pnpm-workspace.yaml`. Must NOT edit any Cargo.toml or Cargo.lock.
- WASM lane: `crates/gitinspect-model/**` and `crates/gitinspect-wasm/**` including their manifests, plus `docs/WEBASSEMBLY.md`.
- Sanitize lane: `packages/contracts/**`, `apps/gitinspect/src/{domain,drilldown,inspection}/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`.
- Runtime lane: `crates/gitinspect-core/src/plugins.rs`, `crates/gitinspect-core/tests/**`, and viewport components under `apps/gitinspect/src/components/` (GraphScene, ViewportCameraBridge and tests). Must NOT edit `wasmMain.tsx` or anything under `inspection/`.
- Nobody edits mutation modules or `CHANGELOG.md`.

### Slice: hostile rendering fixtures and the Tauri argument audit
The inspection-JSON validator (01eb806) and share-link navigation hardening (f0793db) are done. Remaining:
1. Hostile fixture tests proving control characters, bidi overrides, oversize strings and `__proto__`/`constructor` keys render inert in the DOM, in labels (including three.js label generation) and in deep links and exports.
2. Audit every Tauri command argument for Rust-side validation with Rust tests (you may build the Tauri crate for this, once, and note the disk rules), and list the final Tauri permissions in your checkpoint.
Do not change limits owned by the runtime lane; do not touch `wasmMain.tsx`.
