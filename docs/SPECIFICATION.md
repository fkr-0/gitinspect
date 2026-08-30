# gitinspect multi-dimensional specification

## 1. Product decomposition

### graph-elements

A Git-agnostic 3D graph world framework with reusable data mapping, procedural node/edge rendering, spatial layout, interaction, camera, labels, LOD, and transaction-preview primitives.

The framework accepts arbitrary data through a stable graph-shaped dataset. Domain packages provide mapping policies rather than subclassing renderer internals.

### gitinspect

A desktop application that builds a Git semantic graph from a local repository, maps Git semantics to graph-elements visuals, supplies inspection content, and stages/qualifies transaction-safe Git mutations in disposable preview sandboxes. The current 0.2.0 product exposes no original-repository apply command.

## 2. graph-elements conceptual dimensions

| Dimension | Required capability | Invariant |
| --- | --- | --- |
| identity | stable node/edge/sub-element IDs | interaction never depends on render-instance order |
| data | arbitrary typed metadata | framework never imports Git types |
| visual grammar | declarative shape/color/size/material/animation mapping | recurring classes look recognizable without labels |
| layout | hierarchical + temporal + force/constraint variants | deterministic for a fixed dataset + seed |
| interaction | hover/click/context/keyboard/modifiers | hit tests resolve to semantic selection units |
| camera | attached-orbit/traversal + free-flight | mode switching preserves orientation and target continuity |
| labels | floating world-space labels with LOD visibility | text content stays data-driven and selectable |
| scale | instancing, aggregate LOD, culling | 100k logical nodes need not equal 100k detailed meshes |
| mutation | staged operations + previews + confirmations | framework transaction model is domain-neutral |
| drill-down | replace current world with child dataset | navigation history can restore prior world/camera |

## 3. Git characteristics → procedural visual mapping

### Commits

| Git property | Visual encoding | Notes |
| --- | --- | --- |
| commit identity | base-plate + abbreviated hash label | stable interaction root |
| message length | plate thickness + restrained tone shift | logarithmically clamped |
| changed text files | yellow cuboids | one sub-element per file while detailed LOD is active |
| text line delta | cuboid volume | `log1p(additions + deletions)` scaling |
| binary file | purple sphere | recognizably different from text changes |
| binary size | sphere volume | logarithmic byte scaling |
| tags attached | transparent outer enclosure | one enclosure, tag count encoded by facets/indicator |
| branches originating/pointing | floating arrows/indicators | count uses discrete recognizable ticks |
| author | label + optional stable author accent | accents cannot override object-class color language |
| authored/commit time | label/inspection metadata | chronology geometry is topological generation; wall-clock gaps do not create empty space |
| merge commit | broader plate/core notch | parent edges make merge topology explicit |
| GPG status | small shield/status indicator | valid/invalid/unknown/unsigned glyph grammar |

### Refs and repository objects

| Object | Base visual | Discrete distinguishing pattern |
| --- | --- | --- |
| local branch | elongated hexagonal prism | solid side stripe |
| remote branch | elongated hexagonal prism | pulsing/dashed side stripe |
| tracking branch | branch prism + paired indicator | connection indicator toward upstream |
| lightweight tag | octahedron | single shell |
| annotated tag | octahedron | currently shares the tag visual class; richer annotation-specific shell/message fidelity remains open |
| stash | translucent torus | indexed tick marks |
| remote | shallow semantic-depth platform near tracked refs | remote URLs/config are represented; live fetch/push health is not claimed |
| repository root | low-detail world anchor | summary only at macro zoom |

## 4. Git relations → conceptual and visual mapping

| Relation | Concept | Visual style | Direction |
| --- | --- | --- | --- |
| parent → child commit | history progression | solid Railfield segment; active HEAD ancestry strongest | left-to-right oldest→newest |
| merge parent → merge child | convergence | controlled peel/convergence route; selected ingress emphasized | parents into merge |
| branch → commit | symbolic/direct ref pointer | dashed branch-colored line + arrow head | ref to target |
| tag → object/commit | named immutable-ish marker | dotted line + diamond head | tag to target |
| stash → base commit | saved working state ancestry | translucent wavy line | stash to base |
| local branch ↔ remote tracking | tracking configuration | thin pulsing line | bidirectional conceptual link |
| commit → tree | object ownership/detail | drill-down-only structural edge | commit to tree |
| tree → tree/blob | filesystem containment | drill-down tree edge | parent to child |
| HEAD → ref/commit | active checkout | bright focus tether | HEAD to target |

## 5. Spatial semantics — Git Railfield

- **X is topology chronology**, oldest→newest, using bounded topological-generation spacing rather than wall-clock distance or identity hashes.
- **Y is branch lane**. The resolved HEAD first-parent spine occupies lane 0; divergence uses compact deterministic neighboring lanes and convergence returns to the target lane through controlled routed bends.
- **Z is semantic depth only**. Commit ancestry is coplanar at Z=0. Local/tag/stash/HEAD/remote signals use shallow bounded offsets so depth explains attachment class instead of object identity.
- Layout is deterministic for a fixed graph; identity is permitted only as a stable tie-break after topology has determined geometry candidates.
- Ref/tag/stash/HEAD nodes are short attached signals physically local to their target commits, not independent orbit/ring islands.
- Remote platforms remain local to their member remote refs rather than being pushed outside the history hull.
- The active HEAD ancestry is the strongest continuous rail; ordinary history avoids repeated arrowhead noise; merge ingress remains explicit but subordinate to the active route.
- DOM labels/accessibility hit surfaces project the same authoritative GraphWorld position through the active camera and never own a second pseudo-layout.

## 6. Interaction grammar

### Mouse modes

`Camera` mode captures pointer movement for orbit/free-look. `Cursor` mode releases pointer lock and renders a 3D/2D cursor for picking.

### Selection granularity

| Input | Granularity | Example |
| --- | --- | --- |
| hover/click | sub-element | one changed-file cube inside a commit |
| Shift | whole node | entire commit |
| Ctrl/Cmd | edge group | all ancestry/ref edges attached to semantic relation |
| Alt | chain | first-parent/branch chain |
| Shift+Alt | cluster | branch/tag/aggregate cluster |

The InteractionManager resolves modifier state into `SelectionGranularity`; domain mapping supplies related semantic IDs.

### Inspection

Click opens an inspection panel. Hover uses delayed transient 3D tooltip labels. Right-click or a keyboard shortcut opens a context menu filtered by the current domain transaction policy.

## 7. Camera grammar

### Attached mode

- attach to a node, orbit locally, and continuously zoom from whole-node to sub-element scale;
- edge traversal chooses an adjacent semantic edge and animates attachment to the next node;
- preserve an orientation frame so walking history does not produce camera roll discontinuities.

### Free-flight mode

- spaceship-style translation plus yaw/pitch/roll-capable look;
- acceleration/damping with speed scaled by world/zoom scale;
- frame-selected-element and return-to-attached shortcuts;
- macro-to-micro zoom without hard scene replacement until LOD policy chooses one.

## 8. Drill-down/transmorphing

World navigation is a stack of `(dataset, mapper, layout, camera snapshot)` frames. Entering a node may resolve a child dataset asynchronously. A Git commit child world contains commit-core, changed-file nodes, optional tree/blob/diff hunks, and ref pointers. Returning restores the parent world deterministically.

## 9. Inspection data

Commit inspection includes hash, author/committer, dates, full message, parents, tree, diff stat, changed files, lazy full diff, signature status, and refs. Branch/tag/remote/stash panels expose the fields from the task vision, with expensive content loaded lazily.

## 10. Mutation model

Mutations are operations collected into a transaction against an immutable `baseRevision`.

The generic graph-elements transaction model can represent later apply states, but GitInspect 0.2.0 deliberately stops at **copy-only preview/confirmation/cancellation** for repository mutation execution. There is no Tauri command that applies to the original repository.

Current GitInspect flow:

`draft → validating → sandbox created → previewed → confirmed | failed | cancelled`

Rules:

1. Draft operations are inert data.
2. Preview executes only in a gitinspect-owned disposable repository copy and computes ref movement, rewritten commit set, conflicts/warnings, and known/predicted hash cascade.
3. Preview is invalid if live repository revision no longer matches the transaction base.
4. Confirmation is single-use evidence bound to the preview transaction/token; it does not authorize an original-repository effect.
5. `create_mutation_sandbox`, `preview_mutation_transaction`, `confirm_mutation_preview`, and `cancel_mutation_sandbox` are the only mutation Tauri commands currently exposed.
6. Original-repository apply remains NO-GO because the external-writer whole-source TOCTOU envelope is not demonstrated; `FinalRepositoryToctou` is terminal in the current safety case.
7. UI drag/reorder operations only alter the draft until explicit preview/confirmation.

## 11. Repository loading and scale

- Accept worktree root, `.git` directory, bare repository, and linked worktree paths.
- Resolve `gitdir:` indirection and common-dir topology.
- Read commits/trees/blobs/refs/packed-refs/remotes/config/hooks through Git-aware APIs rather than ad-hoc parsing where practical.
- Initial compact world snapshot omits expensive full diff/file-detail payloads; bounded commit diffs and path-targeted file/hunk/blob details are fetched lazily and cached by repository revision.
- 100k-commit repositories use generation ranges + lane clusters for macro LOD.
- `.git`/common-dir watcher coalesces bursts and emits revision-invalidating events; frontend requests a fresh snapshot/delta.

## 12. Performance budgets

Target hardware class is an ordinary modern discrete/integrated GPU desktop/laptop.

- 1k commits: detailed world interactive at 60 FPS target.
- 10k commits: all topology visible, nearby commits detailed, distant commits simplified.
- 100k commits: aggregate macro LOD, bounded labels, bounded draw calls; logical history remains searchable/inspectable.
- Pointer hover should resolve within one animation frame for currently pickable geometry.
- Repository snapshot loading should expose progress rather than freeze the UI. The current compact metadata/delta transport reduces blocking work, but explicit repository-open progress events remain an incomplete Phase-6 ergonomics task.
