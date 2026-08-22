Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 4 Integrator — real Git repository → 3D world end to end

This is an integration/review continuation and must run after the Phase-4 Git graph, visual mapping, and inspection/live slices are committed or explicitly handed off. FIRST read latest prolong state, all Phase-4 commits/diffs, active ws-bridge notes/claims, product spec/architecture, and actual focused test commands.

All shell through `run_workspace_command`; never bare `/tmp`; preserve unrelated work; no reset/clean/push/tag/publish/deploy/bulk-format.

## Goals

1. Wire the real Rust repository snapshot through typed Tauri IPC into the Git semantic graph builder, Git mapper, graph-elements layout/LOD/rendering world, interaction manager, camera controller, labels, and inspection panel.
2. Remove Phase-3 placeholders only where real counterparts are proven.
3. Ensure camera/cursor toggle, sub-element hover, Shift whole-node selection, click inspection, context request, labels, and attached/free-flight modes operate coherently.
4. Test against this gitinspect repository and at least one generated fixture with branch divergence, merge, tags, remote config, stash when supported, and packed refs/objects.
5. Verify live repository refresh on a disposable fixture only; do not mutate developer repositories.
6. Record unsupported semantics rather than fabricating them.

## Acceptance

- root `pnpm typecheck`, `pnpm test`, `pnpm build` green;
- graph-elements focused tests green;
- backend `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` green;
- Tauri `cargo check` green;
- real-repo read-only smoke produces a non-empty snapshot/graph/world plan;
- generated merge/tag fixture yields expected semantic edge/node classes;
- `git diff --check` clean;
- scoped diff reviewed and local integration commit made;
- CHANGELOG `## Unreleased` consolidated by the architect/integrator after checking active claims.

Use prolong lock/save/next/unlock at the phase boundary and prepare the Phase-5 LOD/search/drilldown/mutation-preview continuation. Do not push.
