# Changelog

## Unreleased

### Added

- Fail-closed Linux AppImage release qualification with adversarial artifact-auditor tests, exact product/version filename-token validation, hash/size/executable provenance, a bounded read-only release-binary/package smoke entrypoint, dirty-diagnostic separation, and machine-readable environment/build failure evidence.
- Initial public-release roadmap that keeps the existing `v0.2.0` local baseline immutable, targets a new `v0.2.1` patch candidate for the first public package, and separates Linux artifact authority, native GUI evidence, cross-platform claims, and publication authorization.

### Changed

- Release/readiness documentation now matches the tagged 0.2.0 metadata, enabled Tauri bundling, green source/candidate gates, and the historical clean Linux AppImage qualification at `19848b0`; package hashes and qualification receipts are treated as per-run, exact-commit provenance, so the post-hardening revision requires its own fresh clean package receipt rather than inheriting prior artifact authority.
- CI now preserves pnpm-before-Node-cache setup ordering, caches Rust targets, uploads TypeScript V8 coverage, enforces warning-fatal root Biome lint, and adversarially tests the fail-closed version/changelog/bundling, package-auditor, and interrupted-package-harness contracts.
- Release metadata verification now fails closed when any of the four canonical product version sources diverge in verify or candidate mode, while only candidate-specific bundling/changelog requirements remain warnings under verify; the final Git whitespace gate now covers staged and unstaged changes and has a staged-whitespace regression fixture.
- AppImage qualification now confines bundle cleanup and evidence paths to repository-owned release locations, preserves build logs across packaging, rejects non-executable AppImage artifacts, retains prior qualification receipts across interrupted attempts, stores new run sidecars in unique Git-metadata evidence directories, and exits fail-closed on `INT`/`TERM` instead of continuing after cleanup.
- Interaction coverage now locks `PickRegistry` key separation, duplicate rejection, immutable record snapshots, instance fallback, and stale-disposer safety.

## [0.2.0] - 2026-08-30

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
- Fail-closed native release/operator qualification for Linux i3/X11: proves an unused controlled workspace, rejects competing headed Gitinspect runners, waits for the exact WebGL-convergence marker, permits one external Tauri handoff, records active-window/focus/selection provenance, and requires at least three unchanged strict native passes.
- Native release-gate hostile-environment self-tests for reduced-tool applicability and cleanup identity/scope: missing `jq` remains non-zero with explicit applicability, stale PID/start-time snapshots are never signalled, owned process-group cleanup selects exact snapshotted identities without broadening to late same-group descendants, and a repository-local advisory lock prevents overlapping desktop-sensitive qualification invocations from racing the zero-runner preflight.

### Changed

- Product metadata now converges on version 0.2.0 across the Tauri shell, Rust authority crates, and private application package.
- Tauri bundling is enabled for the local release candidate while the compatibility matrix continues to limit qualified packaged operation to the documented Linux lane.
- Debug and test Rust profiles for the native shell and core authority disable incremental compilation to prevent multi-gigabyte compiler-cache growth in long-lived development worktrees.

### Compatibility

- Original-repository mutation apply remains fail-closed and unauthorized; the qualified mutation studio remains preview/sandbox authority only.
- Packaged macOS and Windows operation remains unclaimed by this release.

