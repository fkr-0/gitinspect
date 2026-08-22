# Architecture

## 1. System boundary

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Tauri desktop window                                                │
│                                                                     │
│  React UI        @gitinspect/graph-elements                         │
│  ┌──────────┐    ┌──────────────────────────────────────────────┐   │
│  │ panels   │◀──▶│ GraphWorld / mapper / layout / camera / LOD │   │
│  │ search   │    │ interaction / labels / transaction preview  │   │
│  └────┬─────┘    └──────────────────────┬───────────────────────┘   │
│       │                                 │                           │
│       └──────────── typed app state ────┘                           │
│                         │ Tauri commands/events                     │
└─────────────────────────┼───────────────────────────────────────────┘
                          ▼
                ┌──────────────────────────┐
                │ Rust gitinspect-core     │
                │ gix repository access   │
                │ snapshot/diff/cache      │
                │ file watching            │
                │ transaction preview/apply│
                └─────────────┬────────────┘
                              ▼
                       local repository
```

## 2. Workspace ownership

### `packages/contracts`

Stable serializable records shared between packages. No Three.js, React, Tauri, Rust-generated binding, or Git parser implementation types are exported here.

### `packages/graph-elements`

Generic graph framework. It may depend on React/Three/R3F, but must not depend on gitinspect application code or Git-specific contracts beyond the generic `GraphDataset` definitions.

Expected public API families:

- `GraphWorld`
- `GraphNode` / procedural node descriptors
- `GraphEdge` / edge style descriptors
- `DataMapper`
- `LayoutEngine`
- `InteractionManager`
- `CameraController`
- `LabelSystem`
- `TransactionManager<TDomainOperation, TPreview>`
- LOD and drill-down helpers

### `crates/gitinspect-core`

Rust library (and optionally test CLI) responsible for:

- repository discovery/topology;
- object/ref/remote/stash enumeration;
- commit metadata and diff/stat extraction;
- snapshot revision fingerprinting;
- file watching and event coalescing;
- transaction validation, copy preview, and confirmed apply.

The core must be usable outside Tauri tests.

### `apps/gitinspect`

React/Vite/Tauri application. Git-specific visual mappers live here or in an app-local package until their API stabilizes. The app translates a repository snapshot into a `GraphDataset`, then feeds graph-elements mapper/layout policies.

## 3. Serialization contract

Tauri IPC uses camelCase JSON matching `@gitinspect/contracts`. Rust structs use serde rename rules rather than frontend adapters whenever possible. IPC endpoints return versioned envelopes or records with `schemaVersion`.

Large content rule: full diffs and blobs are fetched lazily by object/path identity. The initial repository snapshot must stay bounded enough for IPC.

## 4. Initial IPC surface

Read-only commands:

```text
open_repository(path) -> GitRepositorySnapshot
refresh_repository(repository_id, expected_revision?) -> GitRepositorySnapshot
get_commit_diff(repository_id, oid, options) -> CommitDiff
get_object_details(repository_id, oid) -> ObjectDetails
start_repository_watch(repository_id) -> watch_id
stop_repository_watch(watch_id) -> void
```

Events:

```text
repository://changed { repositoryId, previousRevision, reason[] }
repository://progress { repositoryId, stage, completed, total? }
```

Mutation commands (later phase):

```text
preview_transaction(repository_id, base_revision, operations, target="copy")
confirm_transaction(repository_id, transaction_id, preview_revision, target_mode)
apply_transaction(repository_id, transaction_id, confirm_token)
cancel_transaction(repository_id, transaction_id)
```

## 5. graph-elements mapping contract

A DataMapper is conceptually:

```ts
interface DataMapper<TNode extends GraphNodeRecord, TEdge extends GraphEdgeRecord> {
  mapNode(node: TNode, context: MappingContext): NodeVisualDescriptor;
  mapEdge(edge: TEdge, context: MappingContext): EdgeVisualDescriptor;
  relatedSelectionIds?(selection: SelectionState, dataset: GraphDataset): readonly ElementId[];
  childWorld?(node: TNode, context: MappingContext): Promise<GraphDataset | undefined>;
}
```

The renderer owns conversion from descriptors to instanced/batched geometry. A mapper must not create Three.js objects directly.

## 6. Layout contract

Layout consumes immutable graph input and emits stable positions plus optional routing metadata:

```text
LayoutInput(dataset, previous?, seed, constraints)
  -> LayoutResult(nodePositions, edgeRoutes?, clusters, bounds, diagnostics)
```

Git layout constraints include topological Y monotonicity, stable branch lanes, first-parent continuity, and merge convergence. Generic layout code receives these as constraints/weights rather than Git conditionals.

## 7. Picking/interaction architecture

Detailed meshes, instanced meshes, labels, and edge hit proxies all register semantic pick records:

```text
render object / instance id
        ↓
PickRegistry
        ↓
{ elementId, interactionKey, semanticKind, availableGranularities }
        ↓ modifier policy
SelectionState
```

This avoids direct coupling between React components and semantic selection.

## 8. LOD architecture

LOD is a policy layer between layout and rendering:

1. logical graph remains complete/searchable;
2. layout produces positions/clusters;
3. viewport/camera policy selects detail tier;
4. render planner emits full node descriptors, simple impostors/instances, or aggregate buckets;
5. selected/hovered/search-hit objects can be promoted above their distance tier.

No LOD operation changes domain identity.

## 9. Testing strategy

### graph-elements

- deterministic mapper/layout unit tests;
- camera state transition tests;
- pick-registry/modifier tests;
- renderer planning tests without WebGL where possible;
- browser smoke tests for real canvas interaction later.

### gitinspect-core

- fixture repositories generated inside repository-local temp directories;
- loose and packed refs/object fixtures;
- merge/tag/stash/remote/worktree cases;
- snapshot determinism and diff-stat tests;
- preview mutations run only on fixture copies;
- no test mutates developer repositories.

### integration

- load this repository and a generated non-trivial fixture;
- assert commits/refs render to graph records;
- headless/browser screenshot or semantic smoke test;
- benchmark synthetic 1k/10k/100k logical histories.

## 10. Security and mutation safeguards

- Frontend never receives a generic shell command endpoint.
- Paths are canonicalized and repository handles are server-side opaque IDs after opening.
- Preview/apply validates that the live revision matches the transaction base.
- Default preview target is a temporary copy located under gitinspect-managed storage, not bare `/tmp`.
- Original-repo apply requires a one-time token produced after explicit confirmation.
- Destructive branch/tag operations remain represented as draft operations until apply.
