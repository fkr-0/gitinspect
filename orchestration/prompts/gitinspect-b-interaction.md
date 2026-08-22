Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 3 Worker B — camera, interaction, labels

Implement the graph-elements camera/interaction/label slice in the shared checkout. Read `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `packages/contracts/src/index.ts`, graph-elements package config, current git status/diffs/log, ws-bridge presence/claims/notes, and latest prolong state first.

All shell through `run_workspace_command`. Never bare `/tmp`. Preserve concurrent changes; no reset/clean/push/tag/publish/deploy/bulk-format.

## Owned scope

- `packages/graph-elements/src/camera/**`
- `packages/graph-elements/src/interaction/**`
- `packages/graph-elements/src/labels/**`

Do not edit package/index/contracts/docs/app/backend/CHANGELOG. Post required exports or cross-track API requests to `.wsbridge:gitinspect`.

## Required implementation

### CameraController

- pure controller/state-machine core plus optional R3F binding adapter;
- modes: `attached` and `free-flight`;
- attached mode: attach to node, orbit target, zoom, transition/traverse to adjacent node while keeping orientation continuity;
- free flight: acceleration, damping, yaw/pitch (roll optional but state-compatible), speed scaling, focus selected element, switch back to attached;
- camera/cursor mouse-mode distinction must be explicit and testable;
- do not bake Git semantics into traversal.

### InteractionManager

- semantic `PickRegistry` mapping render object/instance IDs to elementId + interactionKey + available granularities;
- hover lifecycle with configurable tooltip delay and cancellation;
- click/select, right-click/context request, keyboard shortcut event model;
- modifier policy: default sub-element, Shift node, Ctrl/Cmd edge-group, Alt chain, Shift+Alt cluster;
- support hover highlight state independent of persistent selection;
- stable selection model compatible with `SelectionState` contracts;
- input handling core should be testable without DOM/WebGL.

### LabelSystem

- data-driven label descriptors/policy for world labels/tooltips;
- visibility by importance/distance/LOD and selection promotion;
- collision/budget seam so later optimization can cap visible labels;
- optional React/Drei rendering adapter, but pure policy tests are mandatory.

## Verification and API

Add deterministic Vitest tests for camera transitions, modifier precedence, pick resolution, hover timing using fake timers, and label visibility/budgeting. Typecheck focused package. `git diff --check`.

Leave modules ready for architect barrel exports such as `CameraController`, `PickRegistry`, `InteractionManager`, `LabelSystem`.

Commit locally (`feat(graph-elements): add interaction systems` or similar). Do not edit CHANGELOG; report one proposed Unreleased bullet in `.wsbridge:gitinspect` and final result.

## Self-prolong protocol

Use shared `prolong gitinspect` carefully: lock, save a namespaced `Worker B:` result with commit/checks/blockers, unlock. Do not replace the architect's next prompt unless your slice is incomplete and you coordinated first; do not autonomously duplicate-dispatch a worker.
