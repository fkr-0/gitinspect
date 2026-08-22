Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 3 Worker A — graph-elements rendering core

Build the generic rendering/world slice of `@gitinspect/graph-elements`. This is a shared checkout with parallel workers, so operate only inside your owned paths and coordinate before any exceptional cross-boundary edit.

## Read first

- `docs/SPECIFICATION.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `packages/contracts/src/index.ts`
- `packages/graph-elements/package.json`, `tsconfig.json`, `src/index.ts`
- current git status/log/diffs
- active ws-bridge presence, claims, notes
- `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)` if available

All shell commands must run through `run_workspace_command`. Never write to bare `/tmp`; use repo-local `tmp/` if needed. Do not reset, clean, push, tag, publish, deploy, or bulk-format. Preserve unrelated/concurrent edits exactly.

## Owned scope

You may create/edit only:

- `packages/graph-elements/src/world/**`
- `packages/graph-elements/src/nodes/**`
- `packages/graph-elements/src/edges/**`
- `packages/graph-elements/src/rendering/**`

Do not edit `packages/graph-elements/src/index.ts`, package config, contracts, app/backend code, docs, or CHANGELOG. If a required API export is missing, implement the file and post the desired export to `.wsbridge:gitinspect` for the architect.

## Objective

Implement a Git-agnostic 3D graph rendering core that consumes immutable graph records + visual descriptors and turns them into an efficient scene plan / React Three Fiber world.

Required capabilities:

1. `GraphWorld` composition for scene, lights, background/sky treatment, node and edge render layers.
2. Generic `DataMapper`/mapping context contract local to graph-elements, compatible with records in `@gitinspect/contracts`.
3. `GraphNode` rendering driven by `NodeVisualDescriptor` sub-elements (box, sphere, plane, cylinder, octahedron, torus, label placeholder). No Git branches inside framework code.
4. `GraphEdge` rendering with a generic style registry supporting solid, dashed/dotted, animated flow, width, opacity, arrow/diamond head metadata, and a wavy/polyline path form.
5. A render planner that groups compatible primitives for instancing/batching instead of requiring one React component per primitive at scale.
6. Stable semantic IDs/interaction keys preserved through render planning so Worker B can register picking.
7. Lighting defaults appropriate for readable 3D visualization; expose configuration rather than hard-coding a Git theme.
8. Deterministic pure unit tests for mapping/planning/style decisions without requiring a WebGL context.

Performance intent: detailed 1k-node worlds must avoid pathological draw-call growth; the APIs must permit later aggregate LOD rendering for 10k/100k logical nodes.

## Integration contract

Expose implementation modules that the architect can later barrel-export, preferably named around:

- `GraphWorld`
- `DataMapper`, `MappingContext`
- `GraphNodeLayer`
- `GraphEdgeLayer`
- `planNodeRendering`, `planEdgeRendering`
- `EdgeStyleRegistry`

Do not expose Three.js instances in the domain-facing mapper API. Renderer-internal modules may use Three/R3F freely.

## Verification

- package-focused typecheck of your owned files
- focused Vitest tests
- `git diff --check`
- report exact test counts and any rendering behavior not exercised without a browser

## Commit/changelog

Commit meaningful scoped changes locally with a message such as `feat(graph-elements): add rendering core`. Do not push. Do not edit `CHANGELOG.md`; include one proposed `## Unreleased` bullet in your coordination/result note.

## Self-prolong protocol

This worker participates in the shared `gitinspect` prolong state. Before saving, read the latest state and clearly namespace your result as Worker A so you do not erase other-track facts.

After completing your slice:

1. `prolong lock gitinspect`
2. `echo "Worker A: <exact result, commit, checks, blockers>" | prolong save gitinspect`
3. only if your slice is incomplete, write a narrowly scoped continuation using `prolong next gitinspect`; otherwise do not overwrite the architect's next-phase prompt
4. `prolong unlock gitinspect`

If incomplete and a continuation is truly required, coordinate with the architect before `prolong dispatch gitinspect` to avoid duplicate workers.
