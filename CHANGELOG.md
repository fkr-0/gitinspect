# Changelog

## Unreleased

### Added

- Initial gitinspect product and graph-elements framework specifications.
- Architecture selecting Tauri + Rust/gix for repository authority and React Three Fiber/Three.js for the GPU visualization layer.
- Monorepo contracts for generic graph data, visual mappings, interaction selections, camera state, LOD, repository snapshots, and mutation previews.
- Parallel implementation plan and worker orchestration contract.
- Shared graph-elements package scaffold and autonomous Phase-3 worker prompts.
- Continuous-integration workflow for TypeScript packages and Rust backend/application crates.
- Deferred Phase-4 worker contracts for Git semantic graph construction, procedural visual mapping, real IPC/inspection/live reload, and end-to-end integration.
- Git-agnostic batched 3D graph rendering with configurable world lighting, procedural node primitives, styled/animated edge paths, and semantic render identities for picking.
- Generic attached/free-flight camera controls, semantic picking/selection interactions, delayed hover tooltips, and LOD-aware label policies for graph-elements.
- Deterministic generic hierarchical layout, scalable LOD planning, domain-adapter transactions, and restorable async world drill-down navigation.
- R3F JSX type augmentation is carried through the graph-elements public barrel so TypeScript consumers can compile exported 3D components without app-local type shims.
- Rust/gix repository snapshot backend with worktree, git-dir, linked-worktree and bare-repository discovery, refs/remotes/stashes/hooks enumeration, bounded lazy commit diffs, stable structural revisions, deterministic watch-event coalescing, and real-repository fixture coverage.
- Runnable React/Vite/Tauri gitinspect studio shell with public GraphWorld integration, deterministic repository demo loading, inspection/search/camera-cursor state, typed native repository seams, and inert transaction staging UI.
- Deterministic Git snapshot → semantic `GraphDataset` adaptation with stable commit/ref/remote/HEAD identities, truncated-history boundaries, Git-aware layout constraints, and an app-local procedural visual grammar wired through the public `GraphWorld` API.
- Native Tauri repository authority with explicit folder/file selection, opaque Rust-owned handles, resolved-HEAD OID plus authoritative `headRef` semantics, metadata-first refresh, bounded lazy commit diffs, and `notify`-backed live repository change events with stale/race guards.
- Phase-4 read-only trust boundary: no mutation/apply IPC is exposed; annotated-vs-lightweight tag fidelity, remote fetch/push status, dual-color merge edges, live-world diff sub-elements, and deep patch/blob drill-down remain explicit later-phase work.

