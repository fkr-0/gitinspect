Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Upgrade — dependencies, toolchain and CI actions, one verified step at a time

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Objective

Upgrade conservatively, each as its own commit with the full gate green before the next. Stop and report on the first regression.

1. **Toolchain consistency:** CI uses `dtolnay/rust-toolchain@stable` while local builds use an older rustc and clippy lints differ (see the 1.98 clippy fix and the rustfmt failure on c42bec9). Add `rust-toolchain.toml` pinning one version and use it in CI and local builds; document the update cadence.
2. **GitHub Actions:** `pages.yml` uses `actions/checkout@v6`/`setup-node@v6`, `release.yml` uses `@v7`; align on the newest stable majors, pin by major (SHA-pin third-party actions), keep `permissions` least-privilege, add `concurrency` and a cargo/pnpm cache where missing.
3. **three.js / R3F:** `THREE.Clock` is deprecated (console warning on load). Migrate to `THREE.Timer` where our code uses it and check whether the pinned `three`/`@react-three/fiber`/`drei` versions still match. The single-copy fix (duplicate R3F) already landed as 34e8096: after ANY dependency change run `node scripts/check-single-r3f.mjs apps/gitinspect/dist-wasm` and `node scripts/wasm-smoke.mjs apps/gitinspect/dist-wasm wasm.html` (see docs/WEBASSEMBLY.md) and never reintroduce mismatched peer versions such as differing `@types/react` between workspace packages.
4. **Rust:** review `gix` 0.86 -> latest within the same minor policy, `notify`, `similar`, `sha2`; pin `wasm-bindgen` and the CLI together and test a bump; run `cargo audit`/`cargo deny` and record findings.
5. **JS:** `pnpm outdated`/`pnpm audit`; upgrade within semver-compatible ranges first (vite, vitest, biome, typescript, tauri CLI/API in lockstep with the Rust `tauri` crate).
6. **Release engineering:** add Dependabot/Renovate config grouped per ecosystem; keep Tauri bundler inputs (icons, `bundle.icon`) validated by the existing metadata gate.

## Evidence

Per upgrade: version diff, gate output (`pnpm release:verify`, `pnpm release:candidate`, Pages build + `scripts/wasm-smoke.mjs`), notes on any behaviour change, and what was deliberately not upgraded and why.

## Owned scope

`rust-toolchain.toml`, `.github/workflows/{ci,release,pages}.yml` (keep the guard and smoke steps in `pages.yml`), `Cargo.toml`/`Cargo.lock`, `package.json` manifests and lockfile, `.github/dependabot.yml`, small deprecation migrations in graph-elements. Coordinate lockfile changes through ws-bridge claims.

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff (the legacy `prolong lock/unlock` commands are retired and do nothing): write a namespaced checkpoint to `.ws-bridge/agent-checkpoints/` named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R2-20261008.json) (status, summary, commit hashes, checks run, artifacts, nextSteps, followUpTasks) and submit the typed phase result for your OCP task through the ws-bridge workflow tools. Say plainly if the work is partial or blocked; never report completion you have not verified. Do not dispatch another continuation unless coordinated.

## Round 4 — scope for THIS dispatch only (overrides broader objectives above)

Earlier rounds stopped partial because they attempted too much or collided on shared files. Deliver **one verified slice** and stop. First read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log`; do not redo committed work. State at dispatch: `main` (6d56dd9) is green in CI and locally: typecheck, lint, 233 tests, rustfmt on all four Rust crates, clippy -D warnings on Rust 1.98.0; the shared `node_modules` has a single R3F copy; the shared Rust 1.98.0 toolchain was repaired and verified (rustc, cargo, rustfmt, clippy, wasm32 target). If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint named after your OCP task id (for example GITINSPECT-HARDEN-06-UPGRADE-R4-20261008.json), be explicit about what is done versus not, and commit locally; the coordinator pushes after CI review. Do not edit files owned by another round-4 lane.

Exclusive ownership this round:
- Upgrade lane: `rust-toolchain.toml`, `.github/**`, root `package.json`/`pnpm-workspace.yaml`. It must NOT edit any Cargo.toml or Cargo.lock.
- WASM lane: `crates/gitinspect-model/**` and `crates/gitinspect-wasm/**` including their Cargo.toml/Cargo.lock, plus `docs/WEBASSEMBLY.md`. Only this lane touches those manifests.
- Sanitize lane: `packages/contracts/**`, `apps/gitinspect/src/{domain,drilldown,inspection}/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`.
- Runtime lane: `crates/gitinspect-core/src/plugins.rs`, `crates/gitinspect-core/tests/**`, and viewport components under `apps/gitinspect/src/components/` (GraphScene, ViewportCameraBridge and their tests). It must NOT edit `wasmMain.tsx` or anything under `inspection/`.
- Nobody edits mutation modules or `CHANGELOG.md`.

### Slice: toolchain pin, CI coverage, action alignment, Dependabot
The only blocker last round was a TypeScript error, fixed in 6d56dd9. Your prepared work was rolled back, so redo it:
1. Add `rust-toolchain.toml` pinning Rust 1.98.0 (rustfmt, clippy, wasm32-unknown-unknown) and make CI use that pinned version instead of floating `stable`.
2. Extend `ci.yml` so `gitinspect-model` and `gitinspect-wasm` also run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` (today only core and the Tauri crate are checked, which is how an unformatted model crate slipped in).
3. Align GitHub Action majors across `ci.yml`, `pages.yml`, `release.yml`, keep least-privilege `permissions`, and KEEP the `check-single-r3f` and `wasm-smoke` steps in `pages.yml`.
4. Add `.github/dependabot.yml` grouped per ecosystem (cargo per crate directory, npm, github-actions).
No JavaScript dependency bumps. Commit each item separately, each gated by the frozen-lockfile `pnpm release:verify`.
