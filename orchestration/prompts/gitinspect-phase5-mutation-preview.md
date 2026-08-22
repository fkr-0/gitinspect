Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 5 Worker — safe mutation-preview backend on disposable repository copies

FIRST read latest prolong state; all mutation/safety requirements in specification/architecture; generic `TransactionManager`; current `gitinspect-core` trust boundary; Tauri command surface; Git snapshot revision semantics; git status/log/diffs; active ws-bridge claims/notes. Read actual code before choosing APIs.

All shell via `run_workspace_command`. Never bare `/tmp`; all disposable repositories/copies live under repository-local test/temp roots that are ignored. Preserve concurrent changes and `.ws-bridge`. No reset/clean/push/tag/publish/deploy/bulk-format.

## Non-negotiable safety boundary

**Do not add original-repository mutation apply in Phase 5.** The original opened repository remains read-only. Preview operations must execute only against an explicit disposable/sandbox copy created by the backend. Never call destructive Git commands against the developer checkout or a user-selected original.

## Objective

Build a generic-but-Git-backed preview adapter for the existing transaction state machine:

- backend sandbox/copy lifecycle with opaque sandbox IDs owned by Rust;
- snapshot/revision binding at sandbox creation and stale-original detection before preview;
- operations: branch create/delete/rename, tag create/delete/move, cherry-pick, interactive-rebase reorder, squash/fixup preview where feasible without inventing success;
- transaction input validation and deterministic operation serialization;
- preview result containing before/after semantic snapshot summaries, changed refs, rewritten commit OID mapping, conflicts/failures, and hash-cascade data sufficient for visualization;
- cancellation/cleanup that only removes repository-local generated sandboxes;
- Tauri commands remain narrow and sandbox-ID based—no arbitrary command/path/shell surface;
- frontend adapter stages operations into generic `TransactionManager`, previews, confirms the preview token if the generic contract requires it, but keeps any original-repository “Apply” control disabled;
- conflict cases must return structured preview failure and leave the original untouched.

Prefer gix for inspection/authority. If invoking the installed `git` binary inside a sandbox is substantially safer/simpler for complex porcelain previews, isolate it behind a fixed operation enum and fixed argument construction; never accept arbitrary argv or executable names from the frontend.

## Tests

Generated fixture with branches, divergence, merge, tag and conflicting cherry-pick. For every operation assert original refs/HEAD/index/worktree remain byte/semantic unchanged. Test stale revision rejection, invalid target validation, conflict reporting, cleanup, bounded sandbox roots, and absence of an original-apply command in Tauri handler registration.

## Scope/collaboration

Claim only new backend sandbox/preview paths plus narrowly necessary app transaction adapter/UI tests. Coordinate contract changes first in `.wsbridge:gitinspect`. Do not edit root docs/CHANGELOG; report a proposed bullet and exact safety evidence. Commit meaningful scoped slices locally.

## Self-prolong protocol

At handoff lock/save/unlock a namespaced Phase-5 mutation-preview checkpoint. Do not alter the architect-owned global next prompt or dispatch a continuation without explicit coordination.
