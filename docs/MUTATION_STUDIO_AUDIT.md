# Mutation Studio Audit

Status: **Phase 42 COMPLETE/GREEN** for a repository-owned, fail-closed native release/operator qualification gate. The Phase-41 isolation recipe is now executable through `pnpm release:native-qualify`: it proves a previously absent controlled i3/X11 workspace, refuses existing workspaces, rejects competing headed Gitinspect runners, waits for the exact GraphScene/WebGL convergence marker, permits at most one external Tauri handoff, records machine-checkable X11/window/focus/semantic provenance, and requires at least three unchanged strict native passes. Final qualification is 3/3 green with 120 real rAF samples per run, visible/focused throughout, zero focus/visibility transitions, the real authoritative transformed semantic ID selected with `aria-pressed=true`, exactly one roving tab stop, empty blockers, and zero unrelated active-window transitions after handoff. No production camera/projection/LOD/selection change was required. CPU planner timing remains separate and is never substituted for GPU evidence. A universal strict 16.7 ms frame-budget guarantee remains explicitly **unclaimed**.

Authority boundary: Gitinspect mutation execution remains **disposable-copy preview only**. The application exposes no original-repository apply command. The Phase-28 through Phase-31 original-apply safety case remains **NO-GO** and is not reopened or weakened by Phase 42.

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

## Phase-39 projected-node accessibility closure

Durable implementation commit: `62d5625` (`fix(app): qualify projected graph accessibility`). Phase 39 fixes a concrete real-render-path defect but remains **BLOCKED** on the decisive native projected-node criterion because Tauri/WebKit projection is not reproducibly deterministic.

The production path was traced as `GraphViewport -> GraphScene/R3F -> ViewportProjectionBridge -> projected accessibility overlay`. A headed diagnostic measured the standalone production viewport at **1280 x 0 CSS px**, with a fallback **300 x 150** canvas and **0 projected overlay buttons**, while the authoritative transformed mutation live summary was already present. Selected/search identities were already promoted before label budgeting and the scale planner already admitted selected topology at full LOD. The measured Phase-38 failure was therefore a viewport/container projection defect, not rewrite lineage, LOD, label budgeting, stale authority, or transformed-node admission.

`62d5625` gives `.viewport` an explicit 100% width/height fill contract and exposes each projected overlay button's already-resolved semantic identity as `data-element-id`. The headed gates now require real production-projected authoritative transformed IDs, `aria-pressed=true`, one and only one roving tab stop on that same ID, a polite mutation live region, and no blocker. The native gate separately verifies the effective old->new rewrite selection announcement before it interacts with the first authoritative graph-delta commit that is actually camera-projected. No test-only overlay node, hidden graph model, projection relaxation, or invented split/drop successor was added.

Browser-headed hardware-WebGL corroboration is green and remains explicitly supplemental: 3 x 120 visible/focused samples, 16.7 ms transition medians, 16.7/16.7/16.8 ms p95, 16.8/16.8/50 ms maxima, 31.8/33.3/88.4 ms topology commit latency, and live/pressed/roving all true with an empty blocker. The report retains `nativeFpsClaim=false`.

Native Tauri/WebKit is **not qualified**. A transient diagnostic run observed real projected live/pressed/roving success, but subsequent controlled runs using exactly one focus handoff to the newly-created Tauri window failed closed at `Timed out waiting for projected authoritative transformed node`. Because the same production contract does not reproduce reliably, Phase 39 does not cherry-pick the successful observation. Phase 38 remains the native frame-scheduling authority, and the deeper compositor/WebKit/camera-projection timing cause remains unresolved rather than guessed. A universal strict 16.7 ms frame-budget guarantee remains unclaimed.

AT-SPI also remains an explicit environment boundary. The broker returns `unix:path=/run/user/1000/at-spi/bus_0`, while `IsEnabled=false` and `ScreenReaderEnabled=false`; native Tauri/WebKit runs emit accessibility-bus connection-refused warnings. No native accessibility-tree or screen-reader success is claimed.

Interaction continuity remains release-green through the production semantic model: unique rewrite follows its unique successor; split/drop clear rather than inventing a successor; stale/conflict/truncated authority preserves caller selection; clear/cancellation restores durable selection without transitional residue; Arrow/Home/End roving, Context Menu/Shift+F10, `aria-pressed`, and polite live-region semantics remain covered. The focused interaction matrix is **34/34** green.

Fresh `pnpm release:verify` at `62d5625` is green: graph-elements **48/48**, app **149/149**, recursive typecheck, Biome lint, build, gitinspect-core fmt/clippy/tests, Tauri fmt/clippy/tests/check, and Git whitespace checks all pass. CPU/planner/search scale totals are 23.836 ms at 1k, 107.088 ms at 10k, and 1512.941 ms at 100k; the 100k fuzzy probe is 15.478 ms. These remain CPU/planner/search metrics, not FPS evidence. Startup entry JS is **359.33 kB minified / 107.00 kB gzip**, below the <1 MB startup gate; the deferred GraphScene chunk remains **1,034.30 kB / 280.95 kB gzip** and is not counted as startup entry budget.

Phase-39 durable evidence:

- `.ws-bridge/evidence/gitinspect-phase39-headed-native.txt` — SHA256 `40bb5203851720d2e6d8ef8b1cb47931e156628fcd3c6731c6c3740cf64a339a`
- `.ws-bridge/evidence/gitinspect-phase39-headed-browser.txt` — SHA256 `24b672a314c2db4f14b9521dc4e43779decbcf35bbe64f06c5ba85641c12934f`
- `.ws-bridge/evidence/gitinspect-phase39-release-check.txt` — SHA256 `f450a5db71be14a6c9801a44209a9083b787833de82fb51c79a2a706dd7b04e5`
- `.ws-bridge/evidence/gitinspect-phase39-at-spi.txt` — SHA256 `f174b8e822b818a99877fb926497ed94fee4d52b9fbabbf460efad100d614c62`
- `.ws-bridge/evidence/gitinspect-phase39-final.md` — SHA256 `3dbd41c3f809c8d35b120f5abd5e4938afc6c7a5d9b77f64ed2a32cbaf86ff81`

Original apply remains **NO-GO/unavailable**. No original-repository mutation command, capability, UI enablement, authorization widening, safety-case reopening, publish, deploy, or release action was introduced.

## Phase-40 native projection/camera-handoff closure

Durable Phase-40 implementation commits are `eab58c1` (`test(app): trace native projection lifecycle`) and `144f965` (`test(app): fail closed on native accessibility focus loss`). Phase 40 remains **BLOCKED_EXTERNAL_FOCUS**: instrumentation explains the production camera/projection lifecycle, but the required repeated visible/focused native acceptance cannot be completed in the current desktop environment.

The bounded production diagnostics cover `GraphViewport -> GraphScene/R3F -> ViewportCameraBridge -> ViewportProjectionBridge` without introducing a second graph model, fake projected node, or accessibility-only semantic fork. A real visible/focused native run measured the host at 1280x720, R3F/canvas convergence to 1280x720 (aspect 1.7778), selected transformed semantic ID attachment, topology-fit at the converged aspect, camera-frame publication, and then real projection publication. All four authoritative transformed commits were visible in the projection map; the selected transformed ID `commit:ffffffffffffffffffffffffffffffff00000003` exposed live/pressed/roving semantics with exactly one roving tab stop. This evidence falsifies the provisional-size/topology-fit ordering hypothesis in the observed visible run and does not prove camera restore, stale bridge state, LOD/label planning, or projection ordering defective.

Earlier native focus attempts overlapped multiple Tauri runners and are retained only as diagnostic history. The decisive attempts 5/6/7 were serialized, waited for GraphScene/WebGL convergence, and each performed exactly one focus handoff to the newly-created Tauri window. Each handoff succeeded at the X11 active-window level, but the desktop later moved visibility/focus away from Tauri. WebKit then became hidden/unfocused and rAF stalled after 63/90, 28/90, and 14/90 samples respectively. The strict harness exits 101 for all three and separately rejects accessibility evidence captured after focus/visibility loss. A read-only X11 monitor observed focus returning to a Firefox Developer Edition window during the sequence. The measured remaining blocker is therefore external desktop focus/visibility interference followed by WebKit background throttling; Phase 40 does not infer deeper compositor/WebKit internals and does not relabel hidden-window projection timeout as a production camera defect.

Browser hardware-WebGL remains supplemental and green for the unchanged production projected live/pressed/roving contract, with `nativeFpsClaim=false`. AT-SPI remains environment-blocked and no screen-reader/native accessibility-tree success is claimed.

Final `scripts/release-check.sh --verify` at `144f965` is green: graph-elements **48/48**, app **149/149**, TypeScript/lint/build, gitinspect-core and Tauri fmt/clippy/tests/check, and whitespace gates all pass. CPU/planner/search scale totals are 28.898 ms at 1k, 109.210 ms at 10k, and 1468.358 ms at 100k; the 100k fuzzy probe is 15.441 ms. These remain CPU/planner/search metrics, not FPS evidence. Startup entry JS is **360.48 kB minified / 107.37 kB gzip**, below the <1 MB gate; deferred GraphScene is **1,037.23 kB / 281.54 kB gzip**.

Phase-40 durable evidence:

- `.ws-bridge/evidence/gitinspect-phase40-headed-native.txt` — SHA256 `75515b7e293f52d01a6908b59a3bd531d6718d0c98b8f185c5880b1e95d38882`
- `.ws-bridge/evidence/gitinspect-phase40-headed-browser.txt` — SHA256 `cef419a10a55a954b76201e6fe14d391ff27a64e3c7106b4b2fa30501f6de281`
- `.ws-bridge/evidence/gitinspect-phase40-at-spi.txt` — SHA256 `0fa5641719ed0f7c0059dd8ccba0c5defc7a7ba45d31ca32d9487eb10b74ffb3`
- `.ws-bridge/evidence/gitinspect-phase40-release-check.txt` — SHA256 `fa7c8d8b43f4fedff4690c3b983c6dc64ffac1410df747cfc5dcfc3eb1580003`
- `.ws-bridge/evidence/gitinspect-phase40-final.md` — SHA256 `6c83aae48d571c74f3d4acd3f2eebb0bdbc64bbd20794f19768620398267d208`

Original apply remains **NO-GO/unavailable**. No original-repository mutation command, capability, UI enablement, authorization widening, publish, deploy, tag, or release action was introduced.

## Next bounded tranche

Phase 41 should remain preview-only and bounded to **isolated native focus authority + unchanged repeated projection acceptance**. Establish a controlled native desktop/window-manager condition in which the one permitted Tauri focus handoff is not immediately superseded by unrelated desktop activity; measure the external focus-steal source if that cannot be achieved. Then repeat the exact production real-node contract multiple times: visible/focused throughout, real authoritative transformed semantic ID, `aria-pressed=true`, exactly one roving tab stop, empty projected-node blocker, and no focus/visibility transitions. Do not add continuous refocusing, arbitrary delays, test-only overlays, projection/LOD relaxations, browser substitution, AT-SPI claims while disabled, or any original-apply capability. If the environment still cannot preserve focus, retain **BLOCKED_EXTERNAL_FOCUS** with measured evidence rather than changing production semantics.


## Phase-41 isolated native focus authority closure

Phase 41 makes no product/source change. The Phase-40 implementation/audit authority remains `eab58c1`, `144f965`, and `5c09c4c`; the new result is an environment-controlled repeated qualification of that unchanged strict native contract.

Phase 40 measured unrelated desktop activity taking `_NET_ACTIVE_WINDOW` away from Tauri after the single permitted handoff, including Firefox Developer Edition on the shared i3 workspace 3. Phase 41 does not infer a deeper compositor, i3, X11, Firefox, or WebKit cause. Instead it uses an otherwise-unused i3 workspace **9** as the controlled qualification condition. Before every decisive run there are exactly zero `mutation_preview_native_smoke` processes and zero other headed Gitinspect native-smoke runners. Workspace 9 starts with `_NET_ACTIVE_WINDOW=0x0`; during each decisive run the read-only X11 monitor observes only the transition to the new Tauri `mutation_preview_native_smoke` window and no later external takeover.

The first isolated pilot is green but deliberately excluded from the decisive count because its wrapper keyed the external handoff off the earlier GraphScene measurement marker. Three fresh serialized decisive runs wait for the exact `headed native focus handoff ready after GraphScene/WebGL convergence` marker, discover the exact newly-created Tauri window, and perform exactly one external `wmctrl -ia` handoff. There is no refocus loop, keep-alive click, hidden helper window, arbitrary success delay, test-only projected node, or semantic relaxation. Tauri's own existing `window.set_focus()` can make the window active before the external handoff; all three decisive handoffs therefore have the same exact Tauri ID before and after. The acceptance fact is that unrelated desktop activity never supersedes it afterward.

Three consecutive decisive runs are green:

| Run | Samples | baseline median/p95 | transition median/p95/max | topology commit | visibility changes | focus/blur events |
| --- | ---: | --- | --- | ---: | ---: | --- |
| 2 | 120 | 17/21 ms | 17/19/22 ms | 34 ms | 0 | 0/0 |
| 3 | 120 | 17/22 ms | 17/20/23 ms | 46 ms | 0 | 0/0 |
| 4 | 120 | 16/24 ms | 16/22/30 ms | 32 ms | 0 | 0/0 |

Every decisive report has `frame_renderer=Apple GPU`, an empty timing blocker, `visibilityState=visible`, `documentHasFocus=true`, zero visibility/focus/blur transitions, and stable visible/focused maximum-gap provenance. Every run projects the real selected authoritative transformed semantic ID `commit:ffffffffffffffffffffffffffffffff00000003` and reports live/pressed/roving true with an empty accessibility blocker. The unchanged harness defines `roving=true` only if there are at least two real projected node buttons, exactly one button has `tabIndex=0`, that same button has `aria-pressed=true`, and its `data-element-id` matches the selected transformed ID. Thus Phase 41 qualifies **exactly one** roving tab stop on the real selected projected node rather than inferring it from a hidden graph model.

The measured Phase-40 blocker is therefore resolved for qualification by desktop/workspace isolation: unrelated activity on the shared active workspace was the observed interference source, while the otherwise-unused workspace preserves focus authority across the repeated series. This is only an observed environment-control result; no deeper window-manager/compositor/WebKit mechanism is claimed. No visible/focused camera-restore, topology-fit, stale bridge, LOD/label, or projection-state defect is proven.

Focused transformed-topology/preview interaction continuity remains **34/34** green. Fresh `scripts/release-check.sh --verify` at unchanged source HEAD `5c09c4c75b0bd5f89bc351d4ee7fef641bcc2bc1` is green: graph-elements **48/48**, app **149/149**, TypeScript/lint/build, gitinspect-core and Tauri fmt/clippy/tests/check, and whitespace gates all pass. Startup entry JS is **360.48 kB minified / 107.37 kB gzip**, below the <1 MB gate; deferred GraphScene is **1,037.23 kB / 281.54 kB gzip**.

Fresh CPU/planner/search scale totals are 20.136 ms at 1k, 137.451 ms at 10k, and 1287.022 ms at 100k; the 100k fuzzy probe is 14.518 ms. These are CPU/planner/search measurements only and remain distinct from the native GPU/requestAnimationFrame evidence above. Browser hardware-WebGL was not rerun because native acceptance itself is now qualified; existing browser evidence remains supplemental only with `nativeFpsClaim=false`.

AT-SPI remains an explicit environment boundary. `org.a11y.Bus.GetAddress` still returns the private bus path, but `org.a11y.Status` is now unavailable/not activatable and direct accessibility-bus introspection still fails. The strict projected DOM/native Tauri semantics above are green, but no independent native accessibility-tree or screen-reader success is claimed.

Phase-41 durable evidence:

- `.ws-bridge/evidence/gitinspect-phase41-headed-native.txt` — SHA256 `30e27e78b6b2712548fe35a10a41761ad5426ef002d2213204721d9e53f7f365`
- `.ws-bridge/evidence/gitinspect-phase41-native-focus-monitor.txt` — SHA256 `848d025328b9706bf20dafdcf46cf12942717517ac2948d59c2b6608224420a6`
- `.ws-bridge/evidence/gitinspect-phase41-interaction.txt` — SHA256 `882285f8212a2e8d3d57149e72f5a714abea94cc016e5c735e1ef1344a53daca`
- `.ws-bridge/evidence/gitinspect-phase41-at-spi.txt` — SHA256 `14c458de9c19c21dbfa0beb79a6b8ca4735d380d132126ee6f73f938d297b54a`
- `.ws-bridge/evidence/gitinspect-phase41-release-check.txt` — SHA256 `4f970c4117b8a657a1f75e75b2b5b960b7f15e1a4aac203a4601c28fe606b246`
- `.ws-bridge/evidence/gitinspect-phase41-final.md` — SHA256 `57a5609d113c914b093eeb55912c39fe44b32bfcfa33f03d843de07180236ddc`

Original apply remains **NO-GO/unavailable**. No original-repository mutation command, capability, UI enablement, authorization widening, safety-case reopening, publish, deploy, tag, or release action was introduced.

## Phase-42 fail-closed native release/operator gate

Phase 42 adds repository-owned release tooling only; production projection, LOD, selection, mutation, and authorization semantics are unchanged. The operator entrypoint is `pnpm release:native-qualify`, backed by `scripts/native-release-qualification.sh` (committed SHA256 `fb965e191cae4125be371eb118c0a9636962e44e6ca5bd7dd86399e65a94eb5e`) and a matching ws-bridge release command. The decisive current-byte qualification ran from committed HEAD `655499ec2f24f4ad9d1c0b63810ea3975bb97417`, and its machine summary binds `sourceEvidence.gateSha256` to that exact script hash.

The gate is intentionally narrower and stricter than ad-hoc desktop automation:

- it requires X11+i3 and an absent controlled workspace; the default bounded search selected workspace **9**, and a forced attempt to reuse existing workspace 3 failed closed with `BLOCKED_ENVIRONMENT` and `window_count=3` rather than moving or stealing those windows;
- it rejects `--runs < 3`, so operator flags cannot weaken the minimum repeated-native acceptance;
- it proves zero exact native smoke, native visual/bridge, production Gitinspect, cargo native-smoke launchers, and browser-headed corroboration runners before qualification, then requires exactly one native smoke runner at each handoff;
- it hashes the exact native binary, Rust harness, TypeScript smoke fixture, and gate source, discovers the newly-created X11 client from `_NET_CLIENT_LIST`, verifies its `WM_CLASS`, title, i3 workspace, and launched executable provenance, and records `_NET_ACTIVE_WINDOW` transitions;
- it waits for the exact `headed native focus handoff ready after GraphScene/WebGL convergence…` progress marker before issuing the sole external `wmctrl -ia`; it contains no refocus loop, click synthesis, hidden helper window, or arbitrary post-handoff success delay;
- it fails if any unrelated non-zero `_NET_ACTIVE_WINDOW` is observed after the handoff, while the native harness independently requires visible/focused frame provenance and zero visibility/focus/blur events throughout the measured window;
- cleanup kills only gate-owned in-flight runner/monitor/server processes, restores the original i3 workspace, and leaves the newly-created controlled workspace absent after the final window closes.

Two wrapper defects found during construction were resolved without touching product semantics: one exact-title parser translated the X11 property's terminating newline into a trailing space, and an initial runner detector used Linux's truncated `ps comm` field. Both versions failed closed; the final wrapper uses the exact parsed title and untruncated argv executable basename. `bash -n`, ShellCheck, and `git diff --check` are green on the final gate bytes.

The final serialized native series is **3/3 green** on otherwise-unused workspace 9. Every run records `frame_renderer=Apple GPU`, 120 real rAF samples, `visibilityState=visible`, `documentHasFocus=true`, zero visibility changes, zero focus events, zero blur events, an empty timing blocker, and zero unrelated active-window transitions after handoff. Every run selects the real authoritative transformed semantic ID `commit:ffffffffffffffffffffffffffffffff00000003` with live/pressed/exact-one-roving all true, stable focus, and an empty accessibility blocker. The one permitted external handoff sees the exact Tauri window already active before/after because the existing native harness can focus its own window first; no later desktop takeover occurs.

Final frame timing remains genuine native evidence but is not promoted to a universal frame-budget claim:

| Run | Samples | baseline median/p95 | transition median/p95/max | topology commit |
| --- | ---: | --- | --- | ---: |
| 1 | 120 | 17/20 ms | 17/20/24 ms | 20 ms |
| 2 | 120 | 17/20 ms | 17/21/23 ms | 20 ms |
| 3 | 120 | 17/23 ms | 17/22/26 ms | 22 ms |

Focused transformed-topology/preview interaction continuity is **34/34** green. Fresh committed-HEAD `pnpm release:verify` is green: graph-elements **48/48**, app **149/149**, TypeScript/lint/build, gitinspect-core and Tauri fmt/clippy/tests/check, and whitespace gates all pass. CPU/planner/search scale totals are **16.217 ms** at 1k, **91.410 ms** at 10k, and **1356.159 ms** at 100k; the 100k fuzzy probe is **14.557 ms**. These remain CPU/planner/search measurements only and are distinct from the native GPU/requestAnimationFrame evidence. Startup entry JS is **360.48 kB minified / 107.37 kB gzip**, below the <1 MB gate; deferred `GraphScene` is **1,037.23 kB / 281.54 kB gzip** and is not counted as startup entry budget.

Browser hardware-WebGL was not used as Phase-42 acceptance authority. Its production runner still hard-codes and validates `nativeFpsClaim=false`; existing browser evidence remains supplemental only. AT-SPI was reprobed read-only: `org.a11y.Bus` exposes its private bus address, but `org.a11y.Status` is not activatable and direct registry probing fails. Qualification therefore remains `BLOCKED_ENVIRONMENT`, with `native_accessibility_tree_claim=false` and `screen_reader_claim=false`.

Phase-42 durable evidence on the committed gate bytes:

- `.ws-bridge/evidence/gitinspect-phase42-native-qualification.txt` — SHA256 `8b178dc5d0fc06255adc802ebbfb3becce100db67eae0265ab7a2036c9a01eba`
- `.ws-bridge/evidence/gitinspect-phase42-native-qualification.json` — SHA256 `808f8e89b6157799348c937b393532c0f7e965c1c55f4e703caf1878769ec56e`
- `.ws-bridge/evidence/gitinspect-phase42-interaction.txt` — SHA256 `0f15101a9ddc6e53a936959d2a8fc962dd1a826534d590ad8ff6cfe4a2712bcb`
- `.ws-bridge/evidence/gitinspect-phase42-at-spi.txt` — SHA256 `6368e253a7d558f2d2dd2beded155b924b7988722af87e2a5ae09a0eecf42c9a`
- `.ws-bridge/evidence/gitinspect-phase42-release-check.txt` — SHA256 `5022562462ddf357a32b7731e2f2513e588173738a9cdf061debc8716ecffe72`

Original apply remains **NO-GO/unavailable**. No original-repository mutation command, capability, UI enablement, authorization widening, safety-case reopening, publish, deploy, tag, or release action was introduced.

## Phase-43 adversarial native gate qualification

Phase 43 qualifies the release/operator gate itself rather than adding projection, LOD, mutation, or authorization features. Adversarial review found four concrete release-tooling defects. Three were repaired at `23505c1cb7220932043c3720e2c246e363078859` (`test(release): adversarially harden native gate`); independent verification then caught a fourth executable-provenance defect in those purportedly final bytes, repaired at `4dfe85f0e24bd2c11cb3c2f329a5d5875bd6b115` (`fix(release): verify native runner executables`). The corrected final gate SHA256 is `91d3b5f84b02f290d69f3a1f5177e6ba4e0888fdacf90637d0e442e6e821439f`:

- competing-runner argv matching is token-bound rather than substring-bound, including exact Cargo `run` plus `--bin NAME` / `--bin=NAME` forms and rejecting lookalike browser script names;
- process identity is now the real `readlink -f /proc/<pid>/exe`, passed separately from argv[0]/argv. Direct native runners remain detectable even with a changed argv[0]; argv naming cannot turn `sleep`/Python into native/Cargo/node provenance; the host's `/usr/bin/cargo -> /usr/bin/rustup` proxy is accepted only in Cargo argv[0] mode with the exact native-smoke `run --bin` contract;
- native client discovery requires the exact observed WM_CLASS pair `"mutation_preview_native_smoke", "Mutation_preview_native_smoke"` rather than accepting a substring match;
- active-window transitions are tagged `pre-handoff` or `post-handoff` at observation time, removing the old millisecond-timestamp `>` comparison that could miss a later unrelated transition in the same millisecond as the handoff.

The fourth defect matters because the earlier Phase-43 dummies resolved to `/usr/bin/sleep` or `/usr/bin/python3.14` while the old collector treated their argv[0] names as executable identity. That evidence therefore demonstrated a false positive rather than executable provenance, and the premature `6a40963` COMPLETE/GREEN tracker is superseded by this corrected Phase-43 authority. The repository-owned `release:native-gate-test` now exercises positive and negative real-executable/argv classification, Cargo-via-rustup mode, false-positive and false-negative spoof cases, exact/non-exact WM_CLASS matching, and handoff transition classification without touching the desktop. Bash syntax, ShellCheck, the self-test, and Git whitespace checks are green on the corrected bytes.

Representative preflight blockers were rerun on the corrected final gate using only existing read-only desktop state or gate-owned copied executable fixtures under `.git`. An occupied requested workspace, a copied direct native executable launched with deliberately harmless argv[0], a copied executable named `cargo` with exact `run --bin=mutation_preview_native_smoke`, and a copied executable named `node` with the exact browser-headed script all exit **2** with `BLOCKED_ENVIRONMENT`. Their real `/proc/<pid>/exe` paths are part of the evidence; symlinks/argv renaming are not used as positive provenance. In every case the signature over focused workspace, `_NET_ACTIVE_WINDOW`, `_NET_CLIENT_LIST`, and workspace metadata is byte-identical before/after. No unrelated operator process or window is launched, moved, focused, closed, or killed to manufacture those blockers.

The one-handoff invariant was challenged separately on otherwise-absent workspace **29**. After the exact GraphScene/WebGL readiness-gated handoff, a disposable Phase-43 xterm was created and activated once. The monitor records that exact xterm as a `post-handoff` unrelated non-zero active-window transition, then records Tauri returning active after the owned xterm exits. Native run 1 fails strictly with exit 101, focus/blur instability, and `unrelated_active_window_transitions_after_handoff=1`; runs 2 and 3 are green, so the gate correctly returns overall **FAIL** at **2/3** rather than masking the challenged run. Cleanup restores workspace 3 and the original active window, workspace 29 disappears, and owned process/window residue is zero.

Because the provenance repair changed gate bytes again, Phase 43 reran the complete current-byte native authority from committed HEAD `4dfe85f0e24bd2c11cb3c2f329a5d5875bd6b115`, bound to gate SHA256 `91d3b5f84b02f290d69f3a1f5177e6ba4e0888fdacf90637d0e442e6e821439f`. The serialized series is **3/3 green** on otherwise-unused workspace 9. Every run has zero competing headed runners, exactly one readiness-gated external handoff, `frame_renderer=Apple GPU`, 120 real requestAnimationFrame samples, visible/focused provenance throughout, zero visibility/focus/blur events, the exact selected authoritative transformed ID `commit:ffffffffffffffffffffffffffffffff00000003`, live/pressed/exact-one-roving true, an empty blocker set, and zero unrelated non-zero post-handoff active-window transitions. Per-run raw/native-result/active-window-transition hashes are retained in the machine-readable summary. Cleanup again removes workspace 9 and restores the original desktop focus without residual headed runners.

Focused transformed-topology/preview continuity remains **34/34** green. Full release verification on the repaired committed gate is green across graph-elements **48/48**, app **149/149**, workspace TypeScript/lint/build, gitinspect-core fmt/clippy/tests, Tauri fmt/clippy/tests/check, 1k/10k/100k CPU/planner/search instrumentation, startup-entry budget, and Git whitespace checks. Startup entry JS remains **360.48 kB minified / 107.37 kB gzip**, below the <1 MB gate; deferred `GraphScene` remains **1,037.23 kB / 281.54 kB gzip**. CPU/planner/search measurements remain separate from native GPU/requestAnimationFrame evidence.

The platform boundary remains intentionally scoped. `release:verify` and the ordinary release checklist stay general; `release:native-qualify` is the authoritative **Linux i3/X11 native GPU/projection lane** only and is not introduced as an unconditional macOS/Windows packaging prerequisite. No package candidate was enabled or cut. Browser hardware-WebGL remains supplemental: its production contract still requires `nativeFpsClaim=false`, and the native gate records `browserSupplementalOnly=true` / `browserNativeFpsClaim=false`.

AT-SPI was reprobed read-only. `org.a11y.Bus.GetAddress` returns the private bus path, but `org.a11y.Status` is not activatable and direct registry connection is refused. The separate accessibility result therefore remains `BLOCKED_ENVIRONMENT`; `native_accessibility_tree_claim=false` and `screen_reader_claim=false` remain explicit.

Phase-43 evidence on the repaired gate bytes:

- `.ws-bridge/evidence/gitinspect-phase43-adversarial.txt` — adversarial blocker and one-handoff challenge evidence;
- `.ws-bridge/evidence/gitinspect-phase43-native-qualification.txt` — SHA256 `8f5b1d43e8f4ad118cbccb282b56f2b2edb8c5c9e513b80b0c8624b8f769ef91`;
- `.ws-bridge/evidence/gitinspect-phase43-native-qualification.json` — SHA256 `d64abb50f9b879cefdc33fd8150060e4eb409b8f9e5654597c88d457ffc69050`;
- `.ws-bridge/evidence/gitinspect-phase43-interaction.txt` — SHA256 `b2f1e8449dd996a5a2fa6b681a72c7fb242efc44d534012ff6f6992aeaaa00ae`;
- `.ws-bridge/evidence/gitinspect-phase43-at-spi.txt` — SHA256 `847840e3f11db716e9295acee60ab824ee35c839e4be6a6fe92b76a4f6d6d9b9`.

Original apply remains **NO-GO/unavailable**. No original-repository mutation path, command, capability, UI enablement, authorization widening, Phase-28–31 safety-case reopening, package enablement, publish, deploy, tag, or release action was introduced.

## Next bounded tranche

Phase 44 should remain release-tooling-only and preview-only. Independently replay the Phase-43 gate self-test and committed evidence contract, qualify fail-closed interruption/cleanup of only gate-owned processes if it can be done without disturbing unrelated desktop state, and verify the native i3/X11 applicability boundary remains opt-in to that qualified environment rather than leaking into generic macOS/Windows release verification. Do not change production projection/LOD/selection truth unless a new visible/focused native defect is proven; keep browser hardware-WebGL supplemental with `nativeFpsClaim=false`, AT-SPI read-only and separately claimed, and original apply **NO-GO**.
