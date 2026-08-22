Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 4 Worker — inspection UI + backend IPC + live reload

Run after Phase 3 integration. FIRST inspect latest prolong state, current tree/status/log, active ws-bridge claims/notes, actual Tauri app shell, actual Rust backend API, contracts, and graph-elements selection APIs. Preserve all concurrent work.

All shell through `run_workspace_command`; never bare `/tmp`; no reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Replace the Phase-3 demo repository seam with real typed Tauri IPC and implement deep inspection/live-refresh without exposing a generic shell boundary.

Required behavior:

- repository picker/path open → native command → opaque repository handle + snapshot;
- loading/progress/error states;
- selection drives an inspection panel for commit/branch/tag/stash/remote objects;
- commit panel: full hash, author/committer/date, message, parents, tree, diff stat, file list, signature state, refs; full diff fetched lazily;
- branch: name/upstream/ahead/behind/last commit;
- tag: name/type/tagger/date/message/target where backend supplies it;
- remote: fetch/push URLs and configured tracking information;
- stash: index/message/base/diff where backend supplies it;
- `.git`/common-dir watch events invalidate/refresh the snapshot with burst coalescing and stale-revision protection;
- search/filter UI may search loaded snapshot metadata but must preserve semantic IDs;
- no mutation apply yet; transaction tray remains preview/staging only.

## Safety

Do not add Tauri shell/plugin access. Canonical paths and repository handles stay Rust-owned. Any unavailable backend inspection field should be explicitly shown as unavailable rather than guessed.

## Verification

Frontend service/state tests using a fake IPC adapter, Rust command tests around a fixture repository, a real read-only smoke against `/home/user/code/gitinspect`, production frontend build, Tauri cargo check, and `git diff --check`.

Claim only the integration/app/Tauri-command paths that do not overlap other active Phase-4 workers. Coordinate backend API additions before writes. Commit locally and report proposed CHANGELOG bullet.

Use prolong lock/save/unlock with a namespaced Phase-4 inspection/live result.
