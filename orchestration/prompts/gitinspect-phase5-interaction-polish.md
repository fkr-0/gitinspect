Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 5 Worker — bind graph interactions/camera/labels into the real Git viewport

FIRST inspect latest prolong state, graph-elements CameraController/InteractionManager/PickRegistry/LabelSystem APIs and tests, committed GraphWorld render identity metadata, Git visual mapper, current viewport/App state, docs, git status/log/diffs, and active ws-bridge claims/notes.

All shell via `run_workspace_command`; never bare `/tmp`; preserve `.ws-bridge` and concurrent edits; no reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Replace the remaining HTML-overlay approximation with the real framework interaction model while preserving accessibility fallbacks.

Required behavior:

- camera mode vs cursor mode genuinely changes pointer ownership in the R3F viewport;
- bind R3F/Three intersections to stable semantic identities from instanced node/edge render metadata through `PickRegistry`;
- default file-sub-element hover/click where present; Shift promotes to whole commit; additional supported modifiers resolve edge/branch/tag related selections through mapper semantics;
- delayed tooltip through `InteractionManager` + `LabelSystem`, cancelled on leave/mode switch/revision replacement;
- click drives the app inspector; context request drives a bounded Git operation menu but mutation items remain staging/preview-only;
- attached camera can attach to a node, orbit, zoom, and traverse an adjacent semantic edge; free-flight has keyboard/mouse motion and smooth mode transitions;
- labels honor LOD/selection/hover priority and collision/budget policies;
- search/list keyboard accessibility remains usable even when WebGL picking is unavailable;
- no Git-specific conditionals should be added to generic graph-elements core unless a true generic adapter hook is missing.

## Verification

Prefer pure controller/registry integration tests and small R3F adapter tests over brittle pixel assertions. Cover instance→semantic resolution, modifier selection, mode switching, tooltip cancellation, revision invalidation, attached traversal, free-flight input, selected-label promotion, and fallback selection. Browser smoke if feasible, but do not claim visual correctness from unit tests alone.

## Scope/collaboration

Claim only non-overlapping viewport interaction/camera/label adapter paths after checking active claims. Coordinate any generic graph-elements extension before editing it. Root docs/CHANGELOG are architect-owned; post proposed bullet + checks. Commit scoped slices locally.

## Self-prolong protocol

At handoff lock/save/unlock a namespaced Phase-5 interaction checkpoint. Do not overwrite global `prolong next` or dispatch another continuation without architect coordination.
