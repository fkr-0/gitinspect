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

## Round 3 — scope for THIS dispatch only (overrides broader objectives above)

Rounds 1 and 2 stopped partial because they tried too much at once. Deliver **one verified slice** and stop. Read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log` first; do not redo committed work. State at dispatch: `main` is green in CI (typecheck, lint, 227+ tests, rustfmt and clippy on 1.98.0), the shared `node_modules` was rebuilt from the frozen lockfile with one R3F copy, and the shared Rust 1.98.0 toolchain was repaired and verified (rustc, cargo, rustfmt, clippy, wasm32 target). If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R3-20261008.json) and be explicit about what is done versus not. Commit locally; the coordinator pushes after CI review. Do not touch files owned by the other round-3 lanes listed below.

Round-3 lanes and exclusive ownership:
- Upgrade lane: `rust-toolchain.toml`, `.github/**`, `Cargo.toml`/`Cargo.lock`, manifests and lockfile.
- Sanitize lane: `packages/contracts/**`, `apps/gitinspect/src/{domain,drilldown,inspection}/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`.
- WASM lane: `crates/gitinspect-model/**`, `crates/gitinspect-wasm/**`, the WASM entry and import component, `docs/WEBASSEMBLY.md`.
- Nobody edits `plugins.rs`, mutation modules or `CHANGELOG.md`. Runtime-hardening work (error boundaries, WebGL recovery) is deliberately NOT in this round.

### Slice: in-memory object/ref sources and snapshot assembly (no packfiles, no worker, no picker this round)
1. In `crates/gitinspect-model`, define the read-only `ObjectSource` and `RefSource` traits and implement an in-memory source over a caller-supplied map of already-inflated Git objects plus a ref list.
2. Assemble the existing snapshot model (commits, refs, tags, parent edges, tree/file metadata within the existing bounds) from that source using the wasm32-compatible `gix-object` and `gix-hash` crates only (default-features = false, sha1). No `gix` facade, no `std::fs`, no `notify`.
3. Prove equivalence: generate a small fixture repository in a repo-local temp directory, inflate its objects with `git cat-file`, and assert the snapshot built from the in-memory source equals the one the native `gitinspect-core` path produces for the same repository (compare serialized JSON).
4. Keep `cargo check --target wasm32-unknown-unknown` green for `gitinspect-model` and `gitinspect-wasm`, and expose nothing new to the UI yet. Document what remains (loose-object inflate, packfile/index reader, worker import, picker, 10k timing) in your checkpoint and in `docs/WEBASSEMBLY.md`.
