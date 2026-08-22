# Implementation plan

## Release milestone: 0.1.0

0.1.0 is a runnable Tauri application that opens real local repositories, renders an interactive 3D history with distinct Git object/edge classes, supports inspection/search/LOD, watches repository changes, and provides transaction previews. Applying mutations to an original repository remains disabled unless the safety suite is complete.

## Phase 1 — conceptual specification and foundation

Status: initialized in the architect session.

- technology evaluation and stack decision;
- graph-elements versus gitinspect specification split;
- Git property/relation visual language;
- repository/monorepo scaffolding and CI/build command contract;
- stable cross-layer record contracts.

Acceptance: docs and contracts typecheck; root repository is clean after commit.

## Phase 2 — architecture and work contracts

Status: initialized in the architect session.

- system boundaries and serialization contracts;
- mapper/layout/picking/LOD APIs;
- repository backend and mutation trust boundary;
- testing strategy;
- independent worker scopes.

Acceptance: implementation tracks have non-overlapping initial path ownership and integration interfaces.

## Phase 3 — parallel framework/backend implementation

Status: **complete** at the Phase-3 integration baseline through `b5271df` plus root closeout verification.

The integrated framework exposes GraphWorld/render planning, camera/interaction/labels, deterministic layout/LOD, transactions, and drill-down through the public package barrel. The Rust backend opens real worktree/git-dir/linked-worktree/bare repositories and supplies metadata-first snapshots plus lazy bounded diffs. The Tauri shell is runnable and consumes GraphWorld through the public package boundary.

Known Phase-4 integration seams are explicit rather than guessed: `GitRepositorySnapshot.head` currently carries the resolved HEAD object ID in the Rust backend; a symbolic HEAD ref needs a separate field if the UI requires both identities. Repository `revision` is a structural snapshot fingerprint for refresh invalidation, not yet a sufficient destructive-mutation freshness token because index/worktree state and hook contents are outside that fingerprint. The watcher core is deterministic/coalescing but still needs a native filesystem event adapter.

### Worker A — graph-elements rendering core

Owns `packages/graph-elements/src/{world,nodes,edges,rendering}` and package setup/tests. Implements generic scene/world composition, procedural descriptors to geometry, edge styles, lighting, and renderer planning/instancing.

### Worker B — graph-elements camera + interaction + labels

Owns `packages/graph-elements/src/{camera,interaction,labels}` and focused tests. Implements attached/free-flight state machines, pick registry, cursor/camera modes, modifier granularity, hover delay, selection, label policy.

### Worker C — graph-elements layout + LOD + transactions

Owns `packages/graph-elements/src/{layout,lod,transactions,drilldown}` and tests. Implements deterministic layered/hierarchical layout, constraints, LOD bucketing/planning, generic transaction state machine, and world navigation stack.

### Worker D — Rust Git backend

Owns `crates/gitinspect-core`. Implements real repository opening, Git data model, refs/remotes/stashes, commit history, stats/diff seams, revision fingerprint, fixture tests, and watcher seam. No destructive mutation apply in first slice.

### Worker E — application shell/integration skeleton

Owns `apps/gitinspect`. Builds Vite/React/Tauri shell, typed adapter around IPC contracts, app state, initial panels and empty GraphWorld integration. It may consume graph-elements/contracts but must not edit their sources.

Each worker updates `CHANGELOG.md` only by posting a coordination note to the architect initially, to avoid a shared-file conflict. The architect consolidates changelog entries between integration commits.

## Phase 4 — Git visual mapping and end-to-end world

Status: **ready to dispatch** from the integrated Phase-3 baseline.

After Phase-3 contracts settle:

- Commit procedural mapper: plates, text cubes, binary spheres, tag enclosure, branch indicators, labels.
- Branch/tag/stash/remote mapper.
- Git-specific edge visual grammar.
- Git layout constraint adapter.
- inspection panel with lazy commit diff.
- live repository watcher integration.
- real-repository smoke test against gitinspect itself and at least one additional repository.

## Phase 5 — scale and mutation studio

- synthetic 1k/10k/100k benchmark datasets;
- macro LOD aggregation and selection promotion;
- search/filter/highlight;
- drill-down commit diff/tree world;
- transaction draft/preview UI;
- Rust mutation preview on copies;
- interactive rebase/cherry-pick/squash/fixup/branch/tag operation previews;
- only then evaluate guarded original-repository apply.

## Phase 6 — release

- end-to-end safety and regression suite;
- Tauri platform packages;
- docs/tutorial/API reference;
- diverse repository compatibility matrix;
- performance evidence;
- version/changelog/release checklist;
- no push/tag/publish without separate operator authorization.

## Integration gates

Every merged worker slice must satisfy:

1. current path claim/coordination state reviewed;
2. package-local focused tests green;
3. root `pnpm typecheck` and `pnpm test` green where applicable;
4. Rust `cargo test` green for backend changes;
5. `CHANGELOG.md` consolidated under `## Unreleased`;
6. scoped diff reviewed before commit;
7. meaningful local commit; never push.

## Self-prolong protocol

At each phase boundary the architect/workers use:

```text
prolong lock gitinspect
prolong save gitinspect
prolong next gitinspect
prolong unlock gitinspect
prolong dispatch gitinspect
```

Workers must persist enough exact state for a continuation to resume without redoing completed work.
