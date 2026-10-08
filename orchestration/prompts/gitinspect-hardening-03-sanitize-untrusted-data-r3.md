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

## Round 3 — scope for THIS dispatch only (overrides broader objectives above)

Rounds 1 and 2 stopped partial because they tried too much at once. Deliver **one verified slice** and stop. Read your previous checkpoint (`.ws-bridge/agent-checkpoints/`, newest file for your area) and `git log` first; do not redo committed work. State at dispatch: `main` is green in CI (typecheck, lint, 227+ tests, rustfmt and clippy on 1.98.0), the shared `node_modules` was rebuilt from the frozen lockfile with one R3F copy, and the shared Rust 1.98.0 toolchain was repaired and verified (rustc, cargo, rustfmt, clippy, wasm32 target). If a gate fails, confirm it also fails on a clean frozen-lockfile install before calling it a blocker. Finish with a checkpoint named after your OCP task id (for example GITINSPECT-HARDEN-03-SANITIZE-R3-20261008.json) and be explicit about what is done versus not. Commit locally; the coordinator pushes after CI review. Do not touch files owned by the other round-3 lanes listed below.

Round-3 lanes and exclusive ownership:
- Upgrade lane: `rust-toolchain.toml`, `.github/**`, `Cargo.toml`/`Cargo.lock`, manifests and lockfile.
- Sanitize lane: `packages/contracts/**`, `apps/gitinspect/src/{domain,drilldown,inspection}/**`, `apps/gitinspect/src-tauri/{src,capabilities}/**`.
- WASM lane: `crates/gitinspect-model/**`, `crates/gitinspect-wasm/**`, the WASM entry and import component, `docs/WEBASSEMBLY.md`.
- Nobody edits `plugins.rs`, mutation modules or `CHANGELOG.md`. Runtime-hardening work (error boundaries, WebGL recovery) is deliberately NOT in this round.

### Slice: enforce the strict inspection-JSON validator at every boundary
The validator `packages/contracts/src/inspectionValidation.ts` exists (7a369e0) but is not integrated. 
1. Wire it at every point where inspection JSON or share-link state enters or leaves the app (import, deep-link parse, export), rejecting unknown fields with typed errors, never silently dropping data.
2. Add a hostile fixture set (control characters, bidi overrides, oversize strings, prototype-pollution keys such as `__proto__`, deeply nested arrays) and tests proving each is rejected or rendered inert in the DOM, labels, deep links and exports.
3. Audit remaining Tauri command arguments for Rust-side validation and add tests; list the final Tauri permissions in your checkpoint.
Do not change the size and depth limits added by the runtime-hardening lane in `inspectionExport.ts`; only wire validation around them.
