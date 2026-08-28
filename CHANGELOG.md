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
- Revision-aware indexed Git search/filter/highlight, 1k/10k/100k scale projection with topology-aware LOD, deterministic aggregate drill targets, and bounded synthetic performance evidence.
- Nested commit/file/hunk/blob drill-down with refresh-safe re-resolution, logical selection preservation, URL/browser-history restoration, and bounded lazy diff/file-detail caches.
- Semantic edge picking and Git modifier selection across changed-file, node, relation, first-parent-chain and ref/tag cluster scopes while preserving authoritative logical identities under search highlighting.
- Preview-only mutation studio with bounded ordered multi-operation staging for branch/tag operations plus cherry-pick, rebase-reorder, squash and fixup; native Tauri qualification covers successful rewrite evidence, structured conflicts, stale revisions, cancellation and cleanup without original-repository apply authority.
- Git Railfield topology visualization with one authoritative camera projection, fitted repository/selection framing, explicit branch peel/merge convergence, local ref/HEAD attachments, topology-aware labels/LOD, and release-gate browser evidence for the synthetic adapter provenance.
- Phase-6 release verification tooling and CI parity: one local `release:verify` gate spans TypeScript, Rust core, Tauri, lint/build/tests and diff-check, while candidate mode fails closed on incomplete package/bundle/changelog metadata.
- Release compatibility matrix documenting qualified Linux worktree, git-dir, linked-worktree, bare, HEAD-state, refs/tags/stash/remotes, bounded diff/content, native watch/refresh, and scale behavior while keeping packaged macOS/Windows support explicitly unclaimed.

