Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 3 Worker C — layout, LOD, transactions, drill-down

Implement the generic algorithmic/control slice of graph-elements. Read the specification/architecture/implementation plan, contracts, graph-elements config, git status/log/diffs, ws-bridge presence/claims/notes, and latest prolong state first.

All shell via `run_workspace_command`; never bare `/tmp`; preserve concurrent edits; no reset/clean/push/tag/publish/deploy/bulk-format.

## Owned scope

- `packages/graph-elements/src/layout/**`
- `packages/graph-elements/src/lod/**`
- `packages/graph-elements/src/transactions/**`
- `packages/graph-elements/src/drilldown/**`

No edits to package/index/contracts/docs/app/backend/CHANGELOG. Request exports/contracts through `.wsbridge:gitinspect`.

## Required implementation

### LayoutEngine

- generic immutable input/output types;
- deterministic layered/hierarchical layout with explicit seed;
- dependency flow monotonic on Y;
- parallel lanes spread on X/Z;
- configurable constraints/weights for temporal hints, preferred parent continuity, group/lane affinity, pinned nodes, spacing;
- must not contain Git-specific conditionals;
- diagnose cycles/disconnected components rather than crashing;
- stable layout when adding a small number of nodes where possible.

### LOD

- compute detail tier from camera/distance/importance;
- aggregate logical nodes into deterministic spatial/semantic buckets;
- preserve member IDs and promotion of selected/hovered/search-hit elements;
- render-plan-facing output that can represent full, simplified, aggregate, and hidden tiers;
- synthetic tests for 1k/10k/100k logical nodes should demonstrate bounded planning memory/time reasonably for unit CI (do not create huge rendered meshes).

### TransactionManager

- generic transaction state machine matching the architecture (`draft → validating → previewed → confirmed → applying → terminal`);
- operations are inert data until a supplied domain adapter previews/applies them;
- base revision validation and stale-preview invalidation;
- default target mode copy; original target must be explicit;
- confirmation token is supplied/validated by the domain adapter, not invented as a security primitive in the renderer;
- cancellation/failure transitions tested.

### Drilldown

- world-navigation stack storing dataset identity + mapper/layout key + camera snapshot;
- async child-world resolver seam;
- enter/back/replace semantics with restoration tests.

## Verification

Focused Vitest tests, typecheck, `git diff --check`. Include deterministic/performance evidence for synthetic layout/LOD planning without claiming GPU FPS.

Commit locally (`feat(graph-elements): add layout and lod core`). No CHANGELOG edit; report proposed bullet via coordination.

## Self-prolong protocol

Lock/save/unlock shared gitinspect state with a namespaced `Worker C:` result. Do not overwrite architect next prompt or dispatch a duplicate continuation unless incomplete and coordinated.
