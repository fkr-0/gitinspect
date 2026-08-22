Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 5 Worker — scale, LOD integration, search/filter/highlight

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, current git status/log/diffs, active ws-bridge presence/claims/notes, the actual graph-elements layout/LOD APIs, the committed Git graph/layout/visual mapper, and the current app state/viewport. Treat landed code as authoritative; do not resurrect Phase-3 seams.

All shell through `run_workspace_command`. Never write bare `/tmp`; use repository-local generated fixtures only. Preserve `.ws-bridge` runtime metadata and every unrelated/concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Make the real Git world remain usable from 1k through 100k logical commits without replacing generic graph-elements abstractions.

Implement a coherent app integration around the existing generic `planLod`/layout machinery:

- camera-distance/importance LOD planning for the Git dataset;
- selected/hovered/search-hit promotion so important identities never disappear into aggregates;
- deterministic aggregate buckets that preserve semantic counts and stable drill targets;
- search over loaded commit/ref/tag/stash/remote metadata with exact/substring matching and a bounded fuzzy option if it is demonstrably cheap;
- filter predicates by object class, author, date/range, ref/branch, signature state, changed path metadata when already loaded, and merge status;
- highlight results without mutating semantic IDs or dataset identity;
- incremental/revision-aware caches so live repository refresh does not recompute unrelated expensive state;
- viewport integration that uses LOD/search state instead of rendering every logical descriptor at full fidelity;
- explicit instrumentation/benchmark functions for planner/layout/mapper costs; do not claim GPU FPS from a headless synthetic benchmark.

## Evidence

Add deterministic synthetic 1k, 10k, and 100k histories and report wall-clock planner/layout/search timings plus retained render identity counts. Tests must cover promotion, stable aggregate identities, filter correctness, search determinism, refresh invalidation, and memory/accounting bounds. Keep benchmark assertions broad enough for CI stability; record exact local numbers separately.

## Scope and collaboration

After inspecting current claims, claim only new app-local `scale/search/filter` paths and narrowly necessary viewport/state paths that do not overlap another active worker. Do not edit Rust backend, contracts, graph-elements internals, root docs, or CHANGELOG without coordination. If a generic graph-elements API extension is truly required, post an exact proposal to `.wsbridge:gitinspect` before touching it.

Commit meaningful scoped slices locally. Post the commit(s), checks, benchmark evidence, and proposed `## Unreleased` bullet to `.wsbridge:gitinspect`.

## Self-prolong protocol

At handoff: `prolong lock gitinspect`; save an exact namespaced Phase-5 scale/search checkpoint with commit hashes/checks/next risk; `prolong unlock gitinspect`. Do not overwrite the architect-owned global next prompt or dispatch another continuation unless explicitly coordinated.
