# GitInspect reusable API reference

Status: **in-repository public-barrel reference for the 0.2.x source tree**

This document describes the reusable TypeScript surface exported by the GitInspect workspace packages. It is intentionally narrower than a public package-publishing promise: both `@gitinspect/contracts` and `@gitinspect/graph-elements` are currently marked `private: true` with workspace version `0.0.0`, and the 0.2.x desktop release does not publish them independently.

For 0.2.x, “public API” therefore means **symbols reachable from each package root barrel and supported for in-repository consumers**. Files below package-internal source paths are implementation details unless they are re-exported from the root barrel.

## Package boundaries

| Package | Root import | Role | Publication status |
| --- | --- | --- | --- |
| `@gitinspect/contracts` | `@gitinspect/contracts` | Data-only graph, repository, diff/detail, selection/camera, and mutation-preview contracts | private workspace package |
| `@gitinspect/graph-elements` | `@gitinspect/graph-elements` | Git-agnostic 3D graph world, rendering planners, interaction, camera, labels, layout, LOD, transactions, and drill-down | private workspace package |
| `@gitinspect/app` | application-local | Git-specific UI, adapters, search, repository services, and desktop integration | not a reusable API surface |

Consumers should import from package roots rather than deep `src/**` paths. The root barrels are the review point for whether a symbol is part of the supported reusable surface.

## `@gitinspect/contracts`

The contracts package contains data shapes only; it does not grant repository authority or perform I/O.

### Generic graph and rendering data

- `ElementId`, `Vec3`
- `GraphElementMetadata`, `GraphNodeRecord`, `GraphEdgeRecord`, `GraphDataset`
- `VisualPrimitive`, `VisualElementDescriptor`, `NodeVisualDescriptor`, `EdgeVisualDescriptor`
- `SelectionGranularity`, `SelectionState`
- `CameraMode`, `CameraState`
- `LodBucket`

`GraphDataset.revision` is the logical dataset revision used by downstream state, cache, and stale-data guards. Element IDs are semantic identities; render-instance identities are handled by graph-elements interaction/rendering types rather than replacing logical IDs.

### Git repository inspection data

- `GitCommitFileChange`, `GitCommitRecord`
- `GitRefRecord`, `GitRemoteRecord`, `GitRepositorySnapshot`
- `GitDiffOptions`, `GitCommitDiff`
- `GitFileDetailOptions`, `GitPatchLineKind`, `GitPatchLine`, `GitPatchHunk`
- `GitFileContentStatus`, `GitCommitFileDetail`

`GitRepositorySnapshot.head` is the resolved object ID when available. `headRef` is the authoritative symbolic HEAD referent for attached or unborn branches and is absent for detached HEAD. Diff and file-detail option types are request bounds; the native authority may enforce stricter server-side limits.

### Mutation-preview data

- `MutationKind`
- `MutationOperation`
- `MutationPreview`

The contract model can represent `targetMode: "copy" | "original"` because the generic transaction vocabulary models both target classes. **That type union is not authorization.** The qualified GitInspect 0.2.x application exposes preview/sandbox behavior only and does not expose original-repository apply authority.

## `@gitinspect/graph-elements`

The graph-elements root barrel re-exports the generic graph contracts needed by consumers and exposes the following reusable subsystems.

### World and mapping

- `GraphWorld`
- `DEFAULT_GRAPH_BACKGROUND`, `DEFAULT_GRAPH_LIGHTING`
- `GraphBackgroundConfig`, `GraphFogConfig`, `GraphLightingConfig`, `GraphWorldProps`
- `resolveNodePositions`
- `DataMapper`, `GraphDatasetView`, `MappingContext`

`GraphWorld` is domain-neutral. Git semantics belong in application/domain adapters that produce generic graph datasets and visual mappings.

### Node, edge, and rendering planning

- `GraphNodeLayer`, `nodeInteractionForInstance`
- `GraphEdgeLayer`, `edgeInteractionForHead`, `edgeInteractionForSegment`
- node/edge interaction handler and event types
- `DEFAULT_EDGE_STYLES`, `EdgeStyleRegistry`, `defaultEdgeStyleRegistry`, `EdgeStyleDefinition`
- `planNodeRendering`, `planEdgeRendering`
- exported render-plan, batch, primitive, edge-style, diagnostic, and `SemanticRenderIdentity` types

Rendering identities are projection identities. They must not be treated as a replacement for authoritative logical element IDs.

### Camera

- `CameraController`
- `AttachRequest`, `TraverseRequest`, `FreeFlightInput`
- `CameraControllerOptions`, `CameraControllerSnapshot`, `CameraOrientation`, `MouseMode`

The controller supports attached and free-flight navigation without depending on Git-specific state.

### Interaction and picking

- `InteractionManager`
- `granularityFromModifiers`, `resolveAvailableGranularity`
- `PickRegistry`
- `HoverState`, `InteractionEvent`, `InteractionManagerOptions`, `ModifierState`, `RelatedSelectionResolver`
- `PickReference`, `RenderObjectId`, `SemanticPickRecord`

`PickRegistry` and semantic interaction records preserve the distinction between renderer instance keys and logical graph identity.

### Labels

- `LabelSystem`
- `LabelBudgetPolicy`, `LabelCollisionPolicy`, `LabelCandidate`, `LabelDescriptor`
- `LabelEvaluationContext`, `LabelDecision`, `LabelHiddenReason`, `LabelPlan`, `LabelSystemOptions`

Label planning is a presentation layer; hidden or budgeted labels do not remove logical graph nodes.

### Layout

- `LayoutEngine`
- `LayoutInput`, `LayoutConstraints`, `LayoutWeights`, `LayoutSpacing`, `LayoutPreviousResult`
- `LayoutResult`, `LayoutBounds`, `LayoutCluster`, `LayoutDiagnostic`, `LayoutDiagnosticKind`

Layout accepts deterministic seed/constraint input, supports previous-position stability and pinned nodes, and reports structural diagnostics rather than silently erasing invalid topology.

### Level of detail

- `computeLodTier`, `planLod`
- `LodTier`, `LodLogicalNode`, `LodCamera`, `LodThresholds`, `LodPromotionState`
- `LodPlanningInput`, node/aggregate/hidden plan types, `LodPlanningStats`, `LodRenderPlan`

LOD is projection-only. The logical dataset remains authoritative; selection/hover/search promotion may raise logical nodes into a visible tier.

### Generic transactions

- `TransactionManager`
- `TransactionStateError`, `StaleTransactionError`
- `TransactionTargetMode`, `TransactionState`
- validation/preview/confirmation/apply/cancel context types
- `TransactionDomainAdapter`, `TransactionManagerOptions`, `TransactionSnapshot`

`TransactionManager` is a domain-neutral state machine. Its generic `apply` and `targetMode` vocabulary does **not** imply that GitInspect authorizes original-repository mutation. Authority belongs to the concrete domain/backend adapter and product safety policy; the 0.2.x GitInspect product keeps original apply unavailable.

### Drill-down navigation

- `WorldNavigationStack`
- `WorldNavigationFrame`, `ChildWorldRequest`, `ChildWorldResolver`, `WorldNavigationSnapshot`

The navigation stack carries dataset, mapper/layout keys, optional semantic selection, and camera state across nested worlds. Asynchronous child resolution fails closed when the parent/generation has changed.

## Stability and support policy for 0.2.x

1. Root-barrel exports above are the reusable in-repository surface. Deep imports are unsupported implementation coupling.
2. The two reusable packages are private workspace packages; this reference does not claim npm publication, independent semantic-version compatibility, or a standalone binary/API distribution.
3. Git-specific repository authority remains in Rust/Tauri and app-local adapters, not in graph-elements.
4. Generic transaction types model capability shapes, not authorization. Original-repository apply remains unavailable in the qualified 0.2.x product.
5. Packaged-platform support is governed by `docs/RELEASE_CHECKLIST.md`, not by TypeScript export availability.

For architectural ownership and safety boundaries, see `docs/ARCHITECTURE.md`. For release qualification and platform claims, see `docs/RELEASE_CHECKLIST.md`.
