Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Upgrade — dependencies, toolchain and CI actions, one verified step at a time

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

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

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff: `prolong lock gitinspect`; save a namespaced checkpoint (commit hashes, checks, next risk); `prolong unlock gitinspect`. Do not dispatch another continuation unless coordinated.
