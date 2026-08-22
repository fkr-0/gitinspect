# Technology evaluation

Date evaluated: 2026-08-22.

## Decision

Use a **hybrid Tauri 2 + Rust/gix + React Three Fiber/Three.js** architecture.

- `graph-elements` is a TypeScript package built on Three.js and React Three Fiber (R3F).
- `gitinspect-core` is Rust using `gix` for repository access and Git-aware operations.
- `gitinspect` is a Tauri 2 desktop shell embedding the React/R3F application and exposing narrow command/event IPC.
- Rendering starts on the stable WebGL renderer and isolates renderer-specific code so a WebGPU renderer can be adopted selectively after capability/performance testing.

Registry state observed during initialization:

| Component | Observed version | Role |
| --- | ---: | --- |
| Three.js | 0.185.1 | renderer / scene graph |
| @react-three/fiber | 9.7.0 | React renderer integration |
| @react-three/drei | 10.7.8 | text, controls and reusable helpers |
| React | 19.2.8 | application/UI composition |
| Vite | 8.2.2 | frontend build |
| TypeScript | 7.0.2 | framework/application types |
| Vitest | 4.1.11 | unit tests |
| gix | 0.86.0 | Git repository model and object access |
| Tauri | 2.11.5 | native desktop shell and IPC |

## Candidate matrix

Scores are relative to this product, 1 (poor) through 5 (excellent).

| Candidate | 100k graph rendering | Procedural geometry | Text/UI | Interaction/picking | Cross-platform packaging | Git/native I/O | Build/iteration cost | Generic library reuse | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Three.js + R3F + Tauri | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | **Chosen** |
| Bevy 0.19 | 5 | 5 | 3 | 4 | 4 | 5 | 3 | 4 | strong native alternative |
| Godot 4.6.x | 4 | 5 | 4 | 5 | 5 | 3 | 4 | 3 | excellent editor, weaker framework packaging story |
| Unreal Engine 5.x | 5 | 5 | 5 | 5 | 4 | 4 | 1 | 2 | unnecessary build/distribution weight |
| raw wgpu | 5 | 5 | 1 | 1 | 3 | 5 | 1 | 5 | maximum control, excessive infrastructure cost |

## Why this split works

### Large graph rendering

Three.js provides instanced and batched geometry paths. R3F/Drei exposes instancing without forcing a bespoke renderer. gitinspect can therefore render thousands of full nodes nearby and collapse distant history into aggregate instanced markers or line segments. The architecture treats React objects as control/state objects, not one React component per visible primitive at maximum scale.

### Generic framework boundary

The graph framework receives `GraphDataset` plus mapping/layout policies. It cannot import Git application modules. A filesystem tree, dependency graph, network topology, or social graph can implement the same mapper interface and use the same camera, selection, layout, edge, label, and LOD systems.

### Native Git access

Tauri removes the browser sandbox problem: the Rust side can open a repository path, resolve worktree/common-dir topology, read packed refs and packfiles through gix, watch `.git`, and execute confirmed mutations in a controlled native process. The TypeScript world never obtains unrestricted shell access.

### Mutation safety

All mutations are modeled as operations on a base repository revision. Preview runs against a copy by default and returns a change set/hash-cascade model. Applying to the original requires a separate, explicit IPC command and confirmation token.

## Why not Bevy as the primary engine

Bevy is the closest alternative and remains a plausible future native renderer. Its ECS/rendering model is well suited to huge graphs, but the product also needs dense inspection panels, text labels, tree/diff UI, searchable tables, context menus, and a reusable graph visualization library. The web UI ecosystem shortens that path substantially while Rust still owns the Git-critical boundary.

## Renderer portability rule

`graph-elements` must not expose Three.js objects as its primary data model. Public API inputs/outputs use framework records and descriptors. Three-specific resources are implementation details under rendering adapters.
