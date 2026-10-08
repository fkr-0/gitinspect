Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Sanitize — treat everything read from a repository as hostile

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

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

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff: `prolong lock gitinspect`; save a namespaced checkpoint (commit hashes, checks, next risk); `prolong unlock gitinspect`. Do not dispatch another continuation unless coordinated.
