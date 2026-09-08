# Implementation plan

## Release milestone: 0.2.0

0.2.0 is the current tagged local release baseline. It is a runnable Tauri application that opens real local repositories, renders an interactive Git Railfield with inspection/search/LOD, watches repository changes, and provides bounded copy-only mutation previews. Applying mutations to an original repository remains disabled because the required whole-source concurrency safety envelope has not been demonstrated.

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

The Phase-3 seams were resolved in Phase 4 without changing the trust boundary. `GitRepositorySnapshot.head` is explicitly the resolved HEAD object ID while `headRef` is the authoritative symbolic referent (present for attached/unborn branches and absent for detached HEAD). Repository `revision` remains a structural snapshot fingerprint for refresh invalidation, not a destructive-mutation freshness token because index/worktree state and hook contents are outside that fingerprint. The deterministic watcher core now has a native `notify` adapter over the worktree Git directory and shared common directory.

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

Status: **complete** through the Phase-4 integration commits `1082529`, `4b2ab8c`, `48b5e80`, `0a39c0b`, `b0c9d07`, and `b4d995d`.

Delivered:

- deterministic real-snapshot → semantic `GraphDataset` mapping with stable commit/ref/remote/HEAD identities, truncated-history boundary nodes, ancestry/ref/tracking relations, and no dangling graph edges;
- Git layout constraints over the generic `LayoutEngine`: ancestry-monotonic Y, first-parent continuity, branch lanes, target-orbit refs/tags/stashes, and remote islands outside the local-history hull;
- app-local procedural Git mapper/theme for commits, changed-file classes, branches, tags, stashes, remotes, HEAD, signatures, and semantic edge styles;
- public `GraphWorld` consumption with the Git mapper, Git layout, and configurable edge-style registry—no app-local renderer fork;
- explicit HEAD contract: `head` is the resolved object ID; `headRef` is the authoritative symbolic referent and is never inferred from coincident ref targets;
- native `notify` filesystem refresh over worktree Git/common directories, surfaced through narrow Tauri commands/events and opaque Rust-owned repository handles;
- native folder/file repository selection, metadata-first open/refresh, optimistic stale-revision guards, race re-check after refresh I/O, and frontend event filtering/cleanup;
- lazy bounded `GitCommitDiff` inspection with server-side limits that frontend callers may tighten but cannot widen;
- real-repository coverage against gitinspect plus repository-local generated fixtures for open/refresh/diff/watch behavior;
- original-repository destructive mutation apply remains absent: no Tauri mutation/apply commands are exposed and the app controls stay inert.

Current Phase-4 fidelity limits are intentional and visible. The backend does not yet distinguish annotated from lightweight tags or report remote fetch/push status; `EdgeVisualDescriptor` currently permits one edge color, so merge edges are thicker single-color rather than true dual-band; native commit-file details hydrate the inspector lazily but are not yet merged back into the live world as post-load file sub-elements; full patch/hunk/blob drill-down remains Phase 5.

## Phase 5 — scale and mutation studio

Status: **implementation/qualification complete for preview-only product scope; original-repository apply remains NO-GO.**

Delivered across the current shared product tree and its durable evidence:

- deterministic synthetic 1k/10k/100k benchmark datasets plus macro LOD aggregation, structural-anchor preservation, selection/search promotion, and bounded render projections;
- revision-aware indexed search/filter/highlight while retaining the complete logical Git graph as authority;
- nested commit → changed-file → bounded hunk/blob drill-down with deterministic `WorldNavigationStack` restoration, refresh-aware revalidation, and bounded URL/history restoration;
- semantic node/sub-element/edge picking with Git-specific modifier relations and camera-projected accessibility labels;
- transaction draft/preview UI with ordered bounded multi-operation staging;
- Rust copy-only mutation preview for branch/tag operations and cherry-pick/rebase-reorder/squash/fixup;
- real Tauri/WebKit preview qualification covering successful rewrite ordering/hash cascades, structured conflicts, stale-revision rejection, cancellation, and sandbox cleanup;
- guarded original-apply Phases 28–31 produced a stronger safety case and durable/fixture primitives but demonstrated that the required external-writer-honored whole-source concurrency envelope is not available in the current architecture. `FinalRepositoryToctou` therefore remains terminal and original apply remains disabled.

## Phase 6 — release

Status: **0.2.0 local release baseline complete; first public packaged-release runway is now explicit.**

- end-to-end safety and regression suite: **qualified** — `pnpm release:verify` provides one repeatable display-independent gate spanning TypeScript, core Rust, Tauri, warning-fatal Biome lint, build/tests and diff-check; the 0.2.0 candidate gate passes with all four canonical product versions converged. CI preserves pnpm-before-setup-node cache ordering, adds Rust target caches, and runs and uploads V8 coverage for both tested TypeScript workspaces;
- Linux packaged-artifact authority: **implemented and clean-lane qualified for the current 0.2.0 tree** — `pnpm release:package-qualify` requires a clean candidate, rebuilds the full gate, confines cleanup to the expected Tauri bundle subtree, audits exact AppImage product/version/hash/size/executable provenance, and runs a bounded read-only repository smoke from the packaged binary. The 2026-09-08 clean run records `releaseQualified=true` for an executable 108,329,464-byte `gitinspect_0.2.0_amd64.AppImage`; the exact SHA-256 is retained per run in the Git-metadata qualification manifest. Consecutive clean builds had equal size but different hashes, so byte reproducibility remains unproven. A future 0.2.1 public candidate must repeat the gate at its own exact clean commit;
- Tauri packaging configuration: **enabled** — `bundle.active=true`; the explicit tracked square icon and `NO_STRIP=1` linuxdeploy compatibility path are exercised by the diagnostic package lane. Network/cache/bootstrap failures remain classified separately as `PREREQUISITE_UNAVAILABLE` rather than being confused with product failures;
- docs/tutorial/API reference: **partial but improved** — README now covers source prerequisites, desktop/frontend run commands, basic inspection/preview workflow, and the safety boundary; architecture/release docs describe the cross-layer runtime path. A consolidated public graph-elements/contracts API reference remains useful follow-up work;
- diverse repository compatibility matrix: **Linux repository/runtime evidence qualified / packaged cross-platform partial** — `docs/COMPATIBILITY_MATRIX.md` records worktree, git-dir, linked-worktree, bare, HEAD-state, refs/tags/stash/remotes, diff-bound, watcher, refresh and scale evidence; packaged macOS/Windows execution remains unclaimed;
- performance evidence: **qualified for synthetic CPU/layout/LOD/search gates plus native Linux i3/X11 projection evidence**, while browser metrics remain supplemental and no packaged cross-platform GPU/FPS claim is made;
- version/changelog/release checklist: **qualified for 0.2.0 metadata** — product/core/Tauri/frontend versions converge on 0.2.0, mismatches in any canonical source fail both verify and candidate metadata checks, the changelog has a dated 0.2.0 section, bundling is enabled, and `pnpm release:candidate` passes;
- browser/WebAssembly/GitHub Pages: separate experimental provenance track; it must not be substituted for desktop/native release qualification;
- local tag `v0.2.0` exists as the immutable local baseline; `docs/INITIAL_RELEASE_ROADMAP.md` recommends a new `v0.2.1` patch candidate for the first public packaged release rather than moving that tag. No push/publish/deploy or new release action is implied without separate operator authorization.

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
