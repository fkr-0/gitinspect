Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 3 Worker E — application/Tauri shell skeleton

Build the first runnable gitinspect application shell in the shared checkout. Read specification/architecture/plan, contracts, graph-elements package public scaffold, current git state, ws-bridge presence/claims/notes, and latest prolong state first.

All shell via `run_workspace_command`; no bare `/tmp`; preserve concurrent changes; no reset/clean/push/tag/publish/deploy/bulk-format.

## Owned scope

- `apps/gitinspect/**`

Do not edit graph-elements/contracts/backend/root docs/CHANGELOG/package root. If an integration API is unavailable, create a small app-local adapter/fake seam rather than editing another worker's scope; post the required integration note.

## Objective

Create a polished but minimal Vite + React 19 + TypeScript + Tauri 2 desktop/web shell that can become the real application as backend/framework workers land.

Required capabilities:

1. Vite React application with a full-window 3D viewport region and desktop-style inspection/sidebar/toolbar layout.
2. Tauri 2 `src-tauri` shell configured with narrow capabilities; do not expose a generic shell plugin or arbitrary command execution.
3. Repository-open UI contract: path input/file/folder selection seam and typed repository service interface. Until Rust backend IPC lands, provide a deterministic demo/synthetic repository adapter behind the same interface.
4. Integrate `@gitinspect/graph-elements` only through currently available exports. If `GraphWorld` is not yet exportable during parallel execution, provide an app-local placeholder boundary so the app still builds; architect will replace it after Worker A integration.
5. App state for repository loading, selected element, camera/cursor mode indicator, inspection panel, search field, transaction tray placeholder.
6. No destructive mutation controls should execute anything; mutation UI is preview/staging placeholder only in Phase 3.
7. Responsive readable dark visualization-studio theme without hard-coding domain renderer internals.
8. Tests for state/service adapters and at least a render smoke test that does not require native Tauri runtime.

## Verification

- `pnpm --filter <app package> typecheck`
- focused Vitest tests
- frontend production build
- `cargo check --manifest-path apps/gitinspect/src-tauri/Cargo.toml` if platform deps permit
- `git diff --check`

Do not launch a persistent dev server unless needed for a short smoke test; terminate it before completion.

Commit locally (`feat(app): scaffold gitinspect studio shell`). Do not edit CHANGELOG; report a proposed Unreleased bullet via `.wsbridge:gitinspect`.

## Self-prolong protocol

Lock/save/unlock the shared state with a namespaced `Worker E:` result. Do not overwrite architect next prompt or dispatch duplicate continuations unless incomplete and coordinated.
