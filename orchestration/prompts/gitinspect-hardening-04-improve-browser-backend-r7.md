Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Improve — a real, read-only browser repository backend (first honest WASM milestone)

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Verified feasibility (2026-10-08, `cargo check --target wasm32-unknown-unknown`)

- the `gix` facade **fails** (`gix-sec` uses Unix `geteuid`/`Metadata::uid`);
- these compile: `gix-hash` (feature `sha1`), `gix-object`, `gix-pack`, `gix-diff` (`blob`), `gix-odb`, `gix-ref`, `gix-revwalk`, `gix-commitgraph`, `gix-date`, all with `default-features = false`.
Compiling is not working: wasm32-unknown-unknown has no filesystem, so ODB/ref access needs a custom byte source.

## Objective

1. Split pure logic out of `gitinspect-core` (model, delta, compact, snapshot assembly, diff over in-memory blobs) into a new `crates/gitinspect-model` that has no `gix` facade, `notify`, `std::fs` or `std::process` dependency and builds for both native and wasm32. `gitinspect-core` re-exports it; behaviour and public types unchanged (all existing core tests stay green).
2. Define a small read-only `ObjectSource` / `RefSource` trait pair (read loose object, read pack range, list refs, read packed-refs). Provide a native implementation (existing) and a browser implementation over a user-selected `.git` directory (File System Access API `showDirectoryPicker`, with a `<input webkitdirectory>` fallback), reading loose objects and packfiles + idx via the compiling gix-* crates.
3. Expose it from `gitinspect-wasm` as a versioned API (bump `API_VERSION`), update `capabilities_json` truthfully (`repositoryMode: "user-selected-readonly"`, `nativeGit: false`, `mutationAuthority: false`), and wire a "Open .git folder" flow in the WASM entry that renders the real graph with the same viewport.
4. Hard limits for memory and object counts; large repos must degrade to the existing LOD/aggregate path with a visible notice, never hang the tab. Run heavy parsing in a Web Worker.
5. Keep the synthetic demo as the zero-click default and label it clearly.

## Evidence

CI builds the wasm crates for `wasm32-unknown-unknown`; a native-vs-wasm equivalence test on a fixture repo (same snapshot JSON for the same repository); browser smoke test loading the fixture `.git` (extend the existing `scripts/wasm-smoke.mjs`; it already gates Pages deploys); timing for a ~10k-commit fixture; updated `docs/WEBASSEMBLY.md` capability table.

## Owned scope

`crates/gitinspect-model/**` (new), `crates/gitinspect-wasm/**`, the minimal extraction edits in `crates/gitinspect-core/src/{model,delta,compact}.rs` and `lib.rs`, WASM entry and an import component under `apps/gitinspect/src/`, `docs/WEBASSEMBLY.md`. Do not touch mutation modules or `plugins.rs`.

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

### Slice: independent snapshot envelope (HEAD and revision) from the in-memory sources
The golden-JSON test (5dd53ee) only compares commit and ref lists; the model does not yet assemble the rest of the snapshot independently.
1. From the in-memory `ObjectSource`/`RefSource` alone, assemble the snapshot envelope the native path emits: HEAD (symbolic or detached), the revision fingerprint, repository metadata fields the UI consumes, and ref listing order.
2. Extend the equivalence test from lists to the FULL golden JSON for the existing fixture, so any difference fails the test. If a field cannot match for a documented reason, exclude it explicitly in the test with a comment stating why, and list it in your checkpoint.
3. Add a second small fixture with a merge commit and an annotated tag, and qualify traversal order on it against the native golden.
Constraints unchanged: model must not depend on `gitinspect-core`, must stay free of the `gix` facade, `std::fs` and `notify`; keep wasm32 checks and clippy -D warnings clean (tests go LAST in a file). Out of scope: loose inflate, pack reader, worker, picker, 10k timing.
