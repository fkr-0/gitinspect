Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Phase 5 Worker — commit drill-down / transmorphing / rich read-only inspection

FIRST read latest prolong state, product/architecture/implementation docs, current Git snapshot/diff contracts, `gitinspect-core`, `WorldNavigationStack` drilldown API, committed semantic Git graph/visual mapper, native Tauri repository service, app inspection UI, git status/log/diffs, and active ws-bridge claims/notes.

All shell via `run_workspace_command`; never bare `/tmp`; preserve concurrent work and `.ws-bridge`; no reset/clean/push/tag/publish/deploy/bulk-format.

## Objective

Implement the first real “enter a commit” experience as read-only transmorphing, using the generic world-navigation seam rather than a Git-specific renderer fork.

Required behavior:

- entering a commit builds a child `GraphDataset` centered on a commit-core with one semantic node per changed path returned by lazy native diff;
- text/binary/add/modify/delete/typechange classes are recognizable visually and retain stable `commit + path` identities;
- changed-file nodes expose additions/deletions/bytes/status and can be inspected without loading arbitrary blob contents;
- parent/ref/tag/branch context is represented as boundary/context nodes where useful, without duplicating the entire repository history;
- `WorldNavigationStack` back restores the exact parent dataset, mapper/layout key, selection context, and camera snapshot;
- asynchronous child resolution must reject stale responses when repository revision or navigation target changes;
- breadcrumb/depth UI and keyboard back action;
- lazy diff cache keyed by opaque repository session + repository revision + commit OID;
- explicitly bounded read behavior: no full patch/hunk/blob content unless a safe backend API exists and is separately bounded.

If backend metadata is insufficient for annotated tag details or richer object inspection, expose “unavailable in current backend” rather than inventing data. Do not implement destructive mutation.

## Verification

Use the demo service plus real native fixture-compatible service seams. Tests: root and merge commits, binary/text changes, empty diff, cache/revision invalidation, stale async resolution, enter/back restoration, unresolved/truncated parent context, and no mutation commands. A real read-only smoke may inspect gitinspect itself.

## Scope and collaboration

Claim only app-local drilldown/navigation/inspection paths and non-overlapping tests. Coordinate any backend/contract addition before edits. Do not edit root docs/CHANGELOG; post a proposed bullet. Commit scoped changes locally and provide exact gates.

## Self-prolong protocol

At handoff use `prolong lock gitinspect`, save a namespaced Phase-5 drilldown checkpoint, then unlock. Do not change global `prolong next` or dispatch without architect coordination.
