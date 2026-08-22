Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 4 Worker — Git procedural node/edge visual grammar

Run only after Phase 3 integration. FIRST inspect latest prolong state, current git history/diffs, active ws-bridge claims/notes, product spec visual tables, actual graph-elements mapper/rendering APIs, and the Git semantic graph builder structure. Adapt to landed APIs rather than inventing parallel abstractions.

All shell via `run_workspace_command`; never bare `/tmp`; preserve concurrent edits; no reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Implement the application-level Git→graph-elements mapper so object classes remain recognizable without labels.

### Commit node

- base plate thickness/tone encodes message length;
- yellow cuboids for text-file changes, logarithmic volume by additions+deletions;
- purple spheres for binary changes, logarithmic volume by byte size;
- transparent enclosure for tagged commits;
- discrete branch-origin/pointer indicators;
- merge/signature indicators where data exists;
- labels: abbreviated oid, author, date, first message line;
- interaction keys on each changed-file sub-element so default hover resolves per-file while Shift resolves whole commit.

### Other node classes

- local/remote/tracking branch prisms with distinct recurring stripe/pulse grammar;
- lightweight/annotated tag octahedra with distinguishable shell grammar;
- translucent indexed stash torus;
- remote platform/island with fetch/push indicators;
- HEAD focus marker if modeled separately.

### Edge classes

- parent→child: solid directional line + subtle flow;
- merge: thicker dual-band/distinct merge style;
- branch pointer: dashed + arrow head;
- tag pointer: dotted + diamond head;
- stash: translucent wavy line;
- remote tracking: thin pulsing line.

Colors, widths, animation, materials, and shape grammar must be configurable theme data where practical; do not put Git conditionals into graph-elements.

## Verification

Add pure mapper tests asserting descriptor structure and visual-class distinctions. Add a render smoke test only if the landed renderer supports headless testing without brittle WebGL assumptions. Verify that a 1k-commit mapped fixture produces bounded descriptor/planning behavior consistent with graph-elements batching/LOD seams.

Claim only the actual app-local mapper/theme paths after inspection. Do not edit graph-elements internals or backend. Commit locally, report checks and proposed CHANGELOG bullet.

Use the shared prolong protocol carefully with a namespaced Phase-4 visual-mapping result.
