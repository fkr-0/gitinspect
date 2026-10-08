Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Clean — remove dead weight without changing behaviour

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Objective

Behaviour-preserving cleanup. Every deletion needs proof it is unused; when in doubt, keep and list it.

- Dead code: run `cargo clippy` with `unused`/`dead_code` visibility, `knip` or `ts-prune`-style analysis for TypeScript exports, and remove unreferenced modules, exports and stale feature flags. Re-check anything touched by `pnpm release:*` scripts before removing.
- Repo hygiene: confirm `target/`, `node_modules/`, `dist*/`, `apps/gitinspect/public/wasm/` generated bindings, `tmp/`, coverage output and `.ws-bridge` runtime state are ignored and not tracked (`git ls-files` audit); report tracked files over 500 KB.
- Docs: remove duplicated or contradictory statements between `README.md`, `docs/*.md` and `CHANGELOG.md` (for example stale "no Git remote" text in `docs/WEBASSEMBLY.md`, "local release candidate" wording once published); fix broken relative links; keep release-evidence files that `release-check.sh` or the roadmap cite.
- Orchestration: index `orchestration/prompts/` by phase and mark superseded prompts in a README table rather than deleting history.
- Scripts: shellcheck all `scripts/*.sh`; remove unused scripts only if no package.json script, workflow or doc references them.
- Formatting/lint: make `biome`, `cargo fmt --check` and `clippy -D warnings` pass locally with the exact CI commands, so CI cannot fail on style again.

## Evidence

A deletion ledger (path, why unused, how verified), before/after tracked-file count and size, link-check output, full gate green (`pnpm release:verify`).

## Owned scope

`docs/**` (except `WEBASSEMBLY.md`, owned by prompt 04), `scripts/**`, `orchestration/**`, `.gitignore`, `biome.json`, dead-code removals confined to files **not** listed in other hardening prompts' scopes. Post any cross-scope removal as a request instead.

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff (the legacy `prolong lock/unlock` commands are retired and do nothing): write a namespaced checkpoint to `.ws-bridge/agent-checkpoints/` named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R2-20261008.json) (status, summary, commit hashes, checks run, artifacts, nextSteps, followUpTasks) and submit the typed phase result for your OCP task through the ws-bridge workflow tools. Say plainly if the work is partial or blocked; never report completion you have not verified. Do not dispatch another continuation unless coordinated.
