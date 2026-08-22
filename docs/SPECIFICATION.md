# gitinspect multi-dimensional specification

## 1. Product decomposition

### graph-elements

A Git-agnostic 3D graph world framework with reusable data mapping, procedural node/edge rendering, spatial layout, interaction, camera, labels, LOD, and transaction-preview primitives.

The framework accepts arbitrary data through a stable graph-shaped dataset. Domain packages provide mapping policies rather than subclassing renderer internals.

### gitinspect

A desktop application that builds a Git semantic graph from a local repository, maps Git semantics to graph-elements visuals, supplies inspection content, and stages/executes transaction-safe Git mutations.

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
| authored/commit time | Y placement + label | layout uses commit generation/order to avoid timestamp anomalies |
| merge commit | broader plate/core notch | parent edges make merge topology explicit |
| GPG status | small shield/status indicator | valid/invalid/unknown/unsigned glyph grammar |

### Refs and repository objects

| Object | Base visual | Discrete distinguishing pattern |
| --- | --- | --- |
| local branch | elongated hexagonal prism | solid side stripe |
| remote branch | elongated hexagonal prism | pulsing/dashed side stripe |
| tracking branch | branch prism + paired indicator | connection indicator toward upstream |
| lightweight tag | octahedron | single shell |
| annotated tag | octahedron | double shell + message marker |
| stash | translucent torus | indexed tick marks |
| remote | floating island/platform | beacon markers for fetch/push state |
| repository root | low-detail world anchor | summary only at macro zoom |

## 4. Git relations → conceptual and visual mapping

| Relation | Concept | Visual style | Direction |
| --- | --- | --- | --- |
| parent → child commit | history progression | solid line, subtle flow | upward/forward |
| merge parent → merge child | convergence | thicker dual-band line | parents into merge |
| branch → commit | symbolic/direct ref pointer | dashed branch-colored line + arrow head | ref to target |
| tag → object/commit | named immutable-ish marker | dotted line + diamond head | tag to target |
| stash → base commit | saved working state ancestry | translucent wavy line | stash to base |
| local branch ↔ remote tracking | tracking configuration | thin pulsing line | bidirectional conceptual link |
| commit → tree | object ownership/detail | drill-down-only structural edge | commit to tree |
| tree → tree/blob | filesystem containment | drill-down tree edge | parent to child |
| HEAD → ref/commit | active checkout | bright focus tether | HEAD to target |

## 5. Spatial semantics

- **Y** is progress/history. Primary topological generation is monotonic upward; timestamps refine spacing but cannot invert ancestry.
- **X/Z** express parallel complexity. Branch divergence creates lateral lanes; long-lived parallel branches retain stable lanes; convergence bends toward merge nodes.
- Layout is deterministic from graph identity plus an explicit seed.
- First-parent history receives lane continuity preference.
- Ref/tag/stash nodes occupy orbit/ring space near their targets, not chronological lanes.
- Remote islands sit outside the local-history hull and connect inward through remote-tracking links.

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

State machine:

`draft → validating → previewed → confirmed → applying → applied | failed | cancelled`

Rules:

1. Draft operations are inert data.
2. Preview defaults to a repository copy and computes ref movement, rewritten commit set, conflicts/warnings, and known/predicted hash cascade.
3. Preview is invalid if live repository revision no longer matches the transaction base.
4. Confirmation produces a single-use token bound to transaction + repository revision + target mode.
5. Original-repository apply is a distinct command and never inferred from preview.
6. UI drag/reorder operations only alter the draft until explicit confirmation.

## 11. Repository loading and scale

- Accept worktree root, `.git` directory, bare repository, and linked worktree paths.
- Resolve `gitdir:` indirection and common-dir topology.
- Read commits/trees/blobs/refs/packed-refs/remotes/config/hooks through Git-aware APIs rather than ad-hoc parsing where practical.
- Initial world snapshot may omit expensive full diffs; per-commit file stats are progressively populated/cached.
- 100k-commit repositories use generation ranges + lane clusters for macro LOD.
- `.git`/common-dir watcher coalesces bursts and emits revision-invalidating events; frontend requests a fresh snapshot/delta.

## 12. Performance budgets

Target hardware class is an ordinary modern discrete/integrated GPU desktop/laptop.

- 1k commits: detailed world interactive at 60 FPS target.
- 10k commits: all topology visible, nearby commits detailed, distant commits simplified.
- 100k commits: aggregate macro LOD, bounded labels, bounded draw calls; logical history remains searchable/inspectable.
- Pointer hover should resolve within one animation frame for currently pickable geometry.
- Repository snapshot loading should stream/progress rather than freeze the UI.
