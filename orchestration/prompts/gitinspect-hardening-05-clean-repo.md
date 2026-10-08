Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Clean — remove dead weight without changing behaviour

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

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

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff: `prolong lock gitinspect`; save a namespaced checkpoint (commit hashes, checks, next risk); `prolong unlock gitinspect`. Do not dispatch another continuation unless coordinated.
