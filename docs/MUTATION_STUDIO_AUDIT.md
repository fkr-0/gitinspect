# Mutation Studio Audit

Status: **Phase 38 COMPLETE/GREEN** for preview-only transformed-topology continuity and controlled headed scheduling authority. The Phase-37 8.292 s event is now reproducibly tied to the native window/workspace visibility/focus condition: hidden/unfocused native WebKit fails closed with zero accepted samples, while two visible/focused native runs recover 16/17 ms median/p95 cadence with 17 ms maxima. CPU planner timing remains separate and is never substituted for GPU evidence. A universal strict 16.7 ms frame-budget guarantee remains explicitly **unclaimed**.

Authority boundary: Gitinspect mutation execution remains **disposable-copy preview only**. The application exposes no original-repository apply command. The Phase-28 through Phase-31 original-apply safety case remains **NO-GO** and is not reopened or weakened by Phase 38.

## Phase-37 durable implementation commits

| Commit | Purpose |
| --- | --- |
| `2a4ddcc` | strengthen reword/split rewrite acceptance fixtures |
| `2ed8895` | preserve authoritative mutation-preview topology metadata/removals |
| `0c03293` | prove dependency-aware drop leaves all original repository bytes unchanged |
| `5b137ff` | complete Rust/shared-contract preview rewrite vocabulary |
| `e25c2b0` | render/author the new rewrites and qualify native headed execution |

## Executable operation matrix

The executable preview surface is the intersection of the tray authoring union, the TypeScript preview contract, and `gitinspect-core::MutationPreviewOperation`. It now contains exactly **13** operation kinds.

| Operation | Real disposable-copy effect | Structured failure/evidence | Authoritative 3D preview | Draft undo/redo |
| --- | --- | --- | --- | --- |
| branch-create | creates branch ref at exact full OID | changed-ref evidence | ref/target delta | yes |
| branch-delete | deletes branch ref | changed-ref evidence | backend-confirmed ref removal | yes |
| branch-rename | renames branch ref | changed-ref evidence | old/new ref topology | yes |
| tag-create | creates tag ref at exact full OID | changed-ref evidence | ref/target delta | yes |
| tag-delete | deletes tag ref | changed-ref evidence | backend-confirmed ref removal | yes |
| tag-move | moves tag ref to exact full OID | changed-ref evidence | before/after target topology | yes |
| cherry-pick | creates rewritten commit | bounded Git/conflict feedback + old/new OIDs | transformed commit/parent/ref delta | yes |
| rebase-reorder | resets branch to `onto`, then cherry-picks an exact linear-range permutation | invalid-range/merge/conflict feedback + hash cascade | transformed commit/parent/ref delta | yes |
| squash | folds the exact linear range into one real commit | invalid-range/merge/conflict feedback + rewrite evidence | transformed commit/parent/ref delta | yes |
| fixup | folds the exact linear range into one real commit | invalid-range/merge/conflict feedback + rewrite evidence | transformed commit/parent/ref delta | yes |
| reword | rewrites one non-root/non-merge commit message and replays descendants | bounded message validation + rewrite/hash-cascade evidence | rewritten target + descendants | yes |
| drop | omits one non-root/non-merge commit and replays descendants | dropped-commit evidence or structured descendant conflict | rewritten descendants/ref delta | yes |
| split | deterministically partitions one eligible commit's authoritative changed paths into two real commits and replays descendants | bounded split validation + two rewrite records | two transformed commit nodes + parent/ref edges | yes |

The shared contract does not advertise arbitrary checkout, arbitrary argv, arbitrary filesystem paths, or any original-repository mutation authority.

## Reword / drop / split bounds and fixtures

### Reword

- branch names retain the bounded safe-ref contract;
- commit targets must be full SHA-1/SHA-256 hexadecimal OIDs;
- the target must begin a bounded linear suffix and cannot be root/merge authority;
- the new UTF-8 message must be non-empty after trim, contain no NUL, and remain at or below 4096 bytes;
- the backend performs a real cherry-pick/amend in the disposable copy and replays descendants, recording every old/new OID and parent cascade.

### Drop

- dropping a dependency-free commit produces a real rewritten branch and explicit dropped-commit evidence;
- the dependency fixture drops a commit that introduces content consumed by its descendant and correctly returns a structured Git/conflict failure when replay cannot preserve semantics;
- the fixture fingerprints **every regular byte of the original source repository, including `.git`**, before and after preview and proves exact byte identity;
- preview cleanup remains scoped to bridge-owned disposable sandboxes.

### Split

- split derives paths only from authoritative `git diff-tree --name-status -z --no-renames` output;
- only added/modified UTF-8 paths are accepted; deletes, renames, copies, type changes, malformed paths, and unsupported counts fail closed;
- changed paths are sorted/deduplicated, bounded to 2-64, and deterministically partitioned at the midpoint;
- the acceptance fixture proves the two real commits partition exactly `split-a.txt` then `split-b.txt`, remain distinct objects, and leave the original repository unchanged.

The established merge, root-range, rename-dependency, stale-revision, cancellation, and conflict fixtures remain green.

## Authoritative transformed-topology contract

Phase 37 replaces the Phase-36 highlight-only limitation with a bounded post-preview graph delta emitted by the Rust backend and consumed by the TypeScript/Tauri/UI path.

Backend delta limits are intentionally bounded:

- at most **512 transformed commits**;
- at most **128 refs**;
- at most **64 parents per transformed commit**;
- commit messages are bounded to **4096 bytes**;
- author identity fields are bounded to **512 bytes**;
- `truncated` is explicit when the backend cannot provide a complete bounded object set.

Each authoritative transformed commit can carry its full OID, parent OIDs, message, author name/email, authored timestamp, and committed timestamp. Ref entries carry name, exact target OID, and ref kind. The frontend creates commit/ref/parent graph objects only from that backend delta; it does not synthesize Git objects from draft intent.

Important merge semantics:

- newly created rewritten commits and parent/ref edges are inserted into the preview dataset from authoritative delta evidence;
- backend-confirmed deleted refs and their incident edges are removed;
- if a transformed commit already exists semantically, authoritative commit fields are updated while richer existing visualization metadata (for example files/tags/branches/signature/head/group/weight) is preserved;
- semantic IDs remain stable (`commit:<oid>`, `ref:<name>`), so selection and keyboard-roving behavior can continue across the transformed dataset;
- the Phase-36 affected-identity decoration remains a fallback for objects mentioned by rewrite evidence but omitted from a bounded/truncated delta. Omitted objects are not fabricated.

## Undo / redo and accessibility

Undo/redo remains bounded **draft** history, not repository rollback. Stage/move/remove operations create history entries, a new edit after undo clears redo, and any stale preview is invalidated before draft history changes. Phase-37 coverage exercises undo/redo with a new `reword` draft as well as the existing operations.

Release tests verify:

- keyboard-roving traversal remains single-tab-stop and selection retains `aria-pressed` semantics;
- new operation controls are keyboard-authorable;
- mutation draft edits receive polite/atomic announcements;
- preview conflicts use alert semantics and cannot expose `Confirm preview only`;
- successful transformed topology receives a polite viewport live summary;
- projected transformed nodes retain accessible labels/selection semantics when projection is available;
- the original-repository `Apply to repository` control remains disabled.

The automated native desktop environment cannot connect to its AT-SPI accessibility bus, so Phase 37 does **not** claim end-to-end screen-reader integration. DOM/unit/integration accessibility semantics are green. The headed transformed-node projection probe also encounters the WebKit frame-scheduling blocker described below and records `Timed out waiting for projected authoritative transformed node` rather than being reported as headed a11y success.

## Release and performance authority

Final post-commit gates are green:

- graph-elements: **48/48** tests;
- app: **145/145** tests across 26 files;
- app Biome lint: clean;
- recursive TypeScript typecheck: clean;
- `gitinspect-core`: all unit/integration/doc tests green;
- `gitinspect-core` clippy, all targets with `-D warnings`: clean;
- Tauri/Rust: all test targets green;
- Tauri clippy, all targets with `-D warnings`: clean;
- staged and unstaged `git diff --check`: clean;
- final source worktree before this audit write: clean.

Final CPU/planner benchmark from the full app release run:

| Logical commits | Scale total | Render nodes | Render edges |
| ---: | ---: | ---: | ---: |
| 1,000 | 21.920 ms | 23 | 25 |
| 10,000 | 100.659 ms | 29 | 59 |
| 100,000 | 1282.982 ms | 224 | 533 |

The 100k fuzzy probe was 14.758 ms in that same run. These remain CPU/planning/search measurements and **are not FPS evidence**.

Production build:

- initial application JS: **357.86 kB minified / 106.57 kB gzip**, safely below the <1 MB startup gate;
- deferred `GraphScene`: **1,034.30 kB minified / 280.95 kB gzip**.

### Headed GPU/frame-timing evidence

A real Tauri/WebKit window was run on `DISPLAY=:0`. Host GL qualification reports direct rendering enabled and accelerated Mesa Intel Iris Xe graphics. The WebKit WebGL context is available; its privacy-normalized renderer string in the smoke is `Apple GPU`.

The corrected native smoke:

- selects the actual nested R3F canvas (`.viewport__canvas canvas`);
- validates that known software renderer strings such as llvmpipe/softpipe/SwiftShader are rejected;
- uses `Builder::build` + `App::run_return` and captures `ExitRequested` codes so a FAIL report cannot return shell success;
- bounds frame sampling and never substitutes CPU timers for headed frame cadence.

The final controlled visible-window qualification is durable at `.ws-bridge/evidence/gitinspect-phase37-final-headed.txt`, SHA256 `6383b49424c87678ba5e08266940f5022413196f7c54b529e16e1b240c313fa8`. It records:

- logical fixture: **1,000 commits**;
- authoritative preview delta: **32 commits**;
- **120** headed transition frame samples;
- baseline median / p95: **16 / 17 ms**;
- transition median / p95: **16 / 17 ms**;
- transition maximum: **8292 ms**;
- samples above 16.7 ms: **14**;
- topology commit latency: **26 ms**;
- `frame_timing_blocker=` empty.

This is genuine headed GPU/frame-timing evidence. Phase 37 nevertheless **does not claim a strict FPS or frame-budget pass**: the 8.292 s maximum is a real scheduling/visibility outlier even though median and p95 cadence are near 60 Hz. The post-audit evidence note at `.ws-bridge/evidence/gitinspect-phase37-post-audit.md` preserves this qualification boundary. CPU planner timings remain separate and are not relabeled as FPS.

The same native smoke passes the real React tray -> production Tauri commands -> disposable Rust backend lifecycle for rebase-reorder, squash, fixup, reword, drop, split, cherry-pick conflict, stale-revision rejection, in-flight cancellation, preview-only confirmation, disabled apply, and zero sandbox leakage. Headed projected-node pressed/roving accessibility remains explicitly unclaimed: the exact blocker is `Timed out waiting for projected authoritative transformed node`, and AT-SPI is unavailable in the automated desktop session; DOM/unit/integration accessibility semantics remain the Phase-37 accessibility authority.

## Phase-38 scheduling and continuity closure

Durable implementation commit: `9f830b9` (`feat(app): qualify mutation topology continuity`).

Phase 38 adds explicit rewrite-lineage continuity over the authoritative backend delta. Complete, successful, revision-matching previews retire old rewritten commit identities, replace parent/ref edges only from authoritative objects, annotate new nodes with old-OID lineage, and move the effective viewport selection only for a unique old->new successor. Drop clears selection; split does not guess among multiple successors; stale, failed, or truncated preview authority does not destructively retire identities or remap selection. A 4,096-node / 64-rewrite regression verifies that no retired identity remains in edges. Clearing/cancelling preview restores the caller's durable root selection without residue.

No decorative topology morph was introduced: the backend evidence supports deterministic object replacement and unique lineage, but not truthful interpolation for split/drop/conflict/truncated/omitted objects. Those cases therefore remain fail-closed rather than visually guessed.

Headed scheduling is now provenance-aware. Native run 1 records `visibilityState=hidden`, `hasFocus=false`, zero timing samples, and the blocker `Timed out waiting for visible focused headed frame window`. Native runs 2 and 3 bring the Tauri window into the visible/focused workspace; both record 120 real transition samples, 16/17 ms median/p95, 17 ms maximum, 23/28 ms topology commit latency, and no blur/visibility changes. Run 3 uses only a one-time focus handoff, proving continuous focus automation is not required. This narrows the Phase-37 multi-second outlier to the native window/workspace visibility/focus scheduling condition, while intentionally leaving compositor-vs-WebKit implementation detail unresolved.

A separate headed Chromium runner uses production `GraphViewport` plus the authoritative preview-delta contracts and hardware WebGL (`ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (RPL-P), OpenGL 4.6)`). Three visible/focused runs × 120 samples have 16.7 ms transition medians, 16.7/16.8/16.8 ms p95, 16.8 ms maxima, and 25.5/27.1/30.5 ms topology commit latency. Its report carries `nativeFpsClaim=false`; browser timing is never relabeled as native Tauri FPS.

Headed projected-node accessibility is still fail-closed rather than overclaimed. Browser live-region evidence is green, but projected pressed/roving selection times out with `Timed out waiting for projected selected transformed node`; native records `Timed out waiting for projected authoritative transformed node`, and AT-SPI remains unavailable. DOM/unit/integration semantics, one-tab-stop roving, `aria-pressed`, conflict alerts, transformed-topology live regions, and keyboard authoring remain release-green.

Phase-38 durable evidence:

- `.ws-bridge/evidence/gitinspect-phase38-headed-run1.txt`
- `.ws-bridge/evidence/gitinspect-phase38-headed-run2.txt`
- `.ws-bridge/evidence/gitinspect-phase38-headed-run3.txt`
- `.ws-bridge/evidence/gitinspect-phase38-headed-browser.txt`
- `.ws-bridge/evidence/gitinspect-phase38-headed-runs.md`
- `.ws-bridge/evidence/gitinspect-phase38-final.md`

Fresh `pnpm release:verify` is green: graph-elements 48/48, app 149/149, workspace typechecks/lint/build, gitinspect-core fmt/clippy/all 68 tests, Tauri fmt/clippy/check and 23 binary tests, and `git diff --check`. Initial application JS is **359.31 kB minified / 106.99 kB gzip**, below the <1 MB startup gate; deferred GraphScene remains 1,034.30 kB / 280.95 kB gzip. Fresh 1k/10k/100k scale numbers remain CPU/planner/search instrumentation only and are recorded in the Phase-38 final evidence.

## Original-apply safety boundary

Unchanged and explicit:

- no original-repository apply command is registered in Tauri;
- the TypeScript mutation service still throws if original apply is invoked;
- the UI Apply control remains disabled;
- mutation authorization continues to classify previewable rewrite operations as fail-closed for original execution;
- Phase-28 through Phase-31 whole-source TOCTOU concerns remain unresolved and out of scope.

Nothing in Phase 38 authorizes, exposes, or simulates original-repository mutation.

## Next bounded tranche

Phase 39 should remain preview-only and focus on the remaining **headed projected-node accessibility / interaction determinism** without weakening visibility semantics:

1. determine why the camera-projected authoritative transformed node is not deterministically exposed to the headed accessibility overlay even when frame cadence is stable, and qualify `aria-pressed` + exactly one roving tab stop only if the real projected node is observable;
2. if AT-SPI becomes available, add a bounded native accessibility-tree check; otherwise preserve the explicit environment blocker and do not claim screen-reader success;
3. exercise keyboard traversal/context/selection continuity across representative unique rewrite, split, drop, stale, conflict, cancellation, and truncated-preview transitions without inventing ambiguous successors;
4. retain the current provenance-aware native/browser headed timing gates and fail closed again if visibility/focus authority is lost;
5. leave original-repository apply **NO-GO/unavailable**.
