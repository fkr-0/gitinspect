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

## Resume context (round 2) — read before acting

This is a continuation of OCP task `GITINSPECT-HARDEN-06-UPGRADE-20261008`, which stopped with status `blocked`. Its checkpoint is `.ws-bridge/agent-checkpoints/GITINSPECT-HARDEN-06-UPGRADE-20261008.json`; read it and `git log` first and **do not redo work already committed**.

Previous summary: Toolchain first slice drafted (Rust 1.98.0 and explicit CI toolchain), but pnpm release:verify failed at app typecheck: GraphScene.tsx:85 CanvasProps lacks className; RuntimeErrorBoundary.tsx:53 error:undefined incompatible with exactOptionalPropertyTypes. Shared checkout modified by concurrent hardening tasks; scoped drafted workflow/toolchain edits reverted, no commit made, no changes made to unrelated work. HEAD at handoff 703e1ad; former initial HEAD 34e8096.

Prior artifacts: .github/workflows/ci.yml, .github/workflows/pages.yml, .github/workflows/release.yml

Remaining work recorded by the previous round:
- Wait for concurrently owned app TypeScript typing defects to be fixed and qualified; do not overwrite their work.
- Reinspect all workspace claims/presence and current HEAD/diffs before retry.
- Reapply a single rust-toolchain.toml 1.98.0 pin, set CI toolchain inputs to 1.98.0, run release:verify then release:candidate then Pages build and smoke before any commit or next upgrade.
- Next risks: rust 1.98 clippy changes, Rust/WASM compatibility, mismatched R3F React peer versions, lockfile contention.

Environment is now healthy: `main` is green in CI at ef572bc+ (typecheck, lint, 227 tests, rustfmt on all four Rust crates), the shared `node_modules` was rebuilt from the frozen lockfile with a single R3F copy, and the earlier TypeScript/Biome/rustfmt blockers were fixed. If a gate fails, first check whether it also fails on a clean frozen-lockfile install before reporting it as a blocker. Local commits are preferred, but finish by pushing nothing: the coordinator pushes after CI review.
