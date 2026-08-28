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
                │ copy-only mutation preview│
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
- transaction validation and repository-local copy/sandbox preview support;
- fail-closed original-apply safety primitives/evidence, without exposing an original-repository executor.

The core must be usable outside Tauri tests.

### `apps/gitinspect`

React/Vite/Tauri application. Git-specific visual mappers live here or in an app-local package until their API stabilizes. The app translates a repository snapshot into a `GraphDataset`, then feeds graph-elements mapper/layout policies.

## 3. Serialization contract

Tauri IPC uses camelCase JSON matching `@gitinspect/contracts`. Rust structs use serde rename rules rather than frontend adapters whenever possible. IPC endpoints return versioned envelopes or records with `schemaVersion`.

Large content rule: full diffs and blobs are fetched lazily by object/path identity. The initial repository snapshot must stay bounded enough for IPC.

## 4. Native IPC surface

The native repository surface remains deliberately narrow. Repository paths are chosen explicitly, opened once, and represented in the frontend by opaque Rust-owned repository IDs rather than reusable filesystem authority. Initial/refresh transport prefers compact metadata and bounded append deltas; expensive content stays lazy.

Implemented repository commands:

```text
choose_repository_path(selection) -> path?
open_repository(path) -> RepositorySession { key, snapshot }
open_repository_compact(path) -> CompactRepositorySession
refresh_repository(repository_id, expected_revision?) -> RepositorySession
refresh_repository_compact(repository_id, expected_revision?) -> unchanged | compact session
refresh_repository_compact_delta(repository_id, expected_revision?) -> unchanged | append delta | full compact session
get_commit_diff(repository_id, oid, options?) -> GitCommitDiff
get_commit_file_detail(repository_id, oid, path, options?) -> GitCommitFileDetail
start_repository_watch(repository_id) -> WatchSession { watchId }
stop_repository_watch(watch_id) -> void
```

Implemented event:

```text
repository://changed { repositoryId, previousRevision, reasons[] }
```

Implemented mutation-preview commands operate only on gitinspect-owned disposable sandboxes:

```text
create_mutation_sandbox(repository_id, base_revision) -> MutationSandboxSession
preview_mutation_transaction(sandbox_id, transaction_id, operations) -> MutationPreviewResult
confirm_mutation_preview(sandbox_id, transaction_id, preview_token) -> MutationPreviewConfirmation
cancel_mutation_sandbox(sandbox_id) -> boolean
```

Generic object-details IPC and repository-open progress streaming remain deferred. Full commit diffs/file details are loaded lazily, and server-side bounds cap blob/probe/file/patch limits even when the frontend requests larger values.

There is deliberately **no original-repository mutation apply command** in the Tauri handler. Phase-31 safety qualification leaves `FinalRepositoryToctou` terminal; preview confirmation does not grant original-apply authority.

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

GitInspect's current app-local Railfield grammar is deterministic and topology-derived: X is oldest→newest topological generation, Y is a stable branch lane with the resolved HEAD first-parent spine on lane 0, and commit ancestry remains on Z=0 while attached signals use shallow semantic depth. Cross-lane ancestry receives explicit controlled peel/convergence routes. Generic graph-elements layout remains Git-agnostic; Git-specific topology and routing live in the app adapter/scale layer rather than identity-hash placement.

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
- managed-browser visual qualification for real canvas interaction using explicit synthetic/native provenance boundaries.

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
- Preview creation validates that the live repository revision matches the transaction base, and stale source state is rejected before sandbox work.
- Default/only mutation execution target in the current product is a disposable copy located under gitinspect-managed repository-local storage, never bare `/tmp`.
- Preview confirmation is single-use evidence bound to the preview transaction; it is not an original-repository apply token.
- The Tauri handler exposes no `apply_mutation` / `apply_to_original` command. Original apply remains NO-GO until a separately authorized safety architecture closes the external-writer whole-source TOCTOU boundary.
- Branch/tag/rewrite operations remain draft/preview-only with respect to the original repository.
