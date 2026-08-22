Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 4 Worker — Git semantic graph builder + layout adapter

This prompt is intentionally deferred until Phase 3 is integrated. FIRST read the latest `prolong latest gitinspect`, current git status/log/diffs, active ws-bridge presence/claims/notes, `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, `packages/contracts/src/index.ts`, the landed `crates/gitinspect-core` public records, landed graph-elements layout APIs, and the actual `apps/gitinspect` structure. Do not assume Phase-3 APIs from this prompt if the code differs.

All shell via `run_workspace_command`. Never write bare `/tmp`. Preserve unrelated/concurrent changes. No reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Build the Git-specific semantic adapter that converts a repository snapshot into a complete `GraphDataset` and supplies layout constraints without introducing Git conditionals into graph-elements.

Required semantics:

- commit nodes for every loaded commit;
- parent→child edges, with merge relations explicitly classified;
- branch, remote-branch, tag, stash, remote, and HEAD semantic nodes when represented by the backend;
- branch/tag/stash/ref pointer edges;
- remote tracking links when upstream data is available;
- stable deterministic IDs based on Git identity rather than array index;
- child/detail metadata sufficient for later commit drill-down;
- Git-specific layout constraint generation: ancestry monotonic on Y, first-parent lane continuity, stable branch lanes on X/Z, merge convergence, ref/tag/stash orbit hints, remote islands outside the local-history hull;
- no Three.js/R3F objects in the semantic graph builder.

## Tests

Use synthetic snapshot fixtures plus at least one snapshot produced by the real backend fixture API. Assert identity stability, complete ancestry, merge classification, ref pointer correctness, deterministic graph output, and layout constraints. Include a 1k+ synthetic history smoke case without claiming GPU performance.

## Collaboration

Claim only the actual app-local Git graph/adapter paths chosen after inspecting the landed tree. Do not edit graph-elements core, Rust backend, root contracts, or shared CHANGELOG. Coordinate any required contract change in `.wsbridge:gitinspect` first.

Commit meaningful scoped changes locally. Report a proposed CHANGELOG bullet and exact checks.

## Self-prolong protocol

Use `prolong lock gitinspect`, save a namespaced Phase-4 Git-graph result, and unlock. Do not overwrite another active track's continuation or duplicate-dispatch without coordination.
