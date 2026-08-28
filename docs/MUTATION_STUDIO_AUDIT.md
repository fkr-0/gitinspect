# Mutation Studio Audit

Status: Phase-36 mutation-studio hardening audit

Authority boundary: Gitinspect mutation execution remains **disposable-copy preview only**. The application exposes no original-repository apply command. The Phase-28 through Phase-31 original-apply safety case remains NO-GO and is not reopened by this work.

## Executable operation matrix

The executable preview surface is the intersection of the tray authoring union, the TypeScript preview contract, and `gitinspect-core::MutationPreviewOperation`. It contains exactly ten operation kinds.

| Operation | Git object/ref effect in sandbox | Structured failure feedback | Live 3D preview feedback | Draft undo/redo |
| --- | --- | --- | --- | --- |
| branch-create | creates branch ref at exact full OID | yes | existing target commit/ref identities when present | yes |
| branch-delete | deletes branch ref | yes | deleted ref/target identities when present | yes |
| branch-rename | renames branch ref | yes | changed ref/target identities when present | yes |
| tag-create | creates tag ref at exact full OID | yes | existing target commit/ref identities when present | yes |
| tag-delete | deletes tag ref | yes | deleted ref/target identities when present | yes |
| tag-move | moves tag ref to exact full OID | yes | changed ref plus before/after object identities | yes |
| cherry-pick | creates rewritten commit in disposable copy | conflict paths + bounded Git failure | old/new/cascade identities when present in authoritative dataset | yes |
| rebase-reorder | resets branch to `onto` and cherry-picks an exact branch-range permutation | invalid-range / merge rejection / conflict feedback | old/new/cascade identities when present | yes |
| squash | combines the exact linear branch range into one commit, reusing the first commit message | invalid-range / merge rejection / conflict feedback | old/new/cascade identities when present | yes |
| fixup | combines the exact linear branch range into one commit, reusing the first commit message | invalid-range / merge rejection / conflict feedback | old/new/cascade identities when present | yes |

The shared `MutationKind` contract previously advertised `checkout` although neither the tray nor the Rust mutation-preview backend implemented it. Phase 36 removes that stale contract member so the shared type no longer overclaims the executable surface.

## Requested rewrite vocabulary versus current implementation

The program request names rebase, squash, reword, drop, reorder, split, and cherry-pick. Current mapping is:

- **rebase / reorder**: represented by `rebase-reorder`; it is intentionally an explicit exact-permutation linear rewrite, not a general interactive rebase interpreter.
- **squash**: implemented for an exact linear branch range.
- **cherry-pick**: implemented for one exact full commit OID per operation.
- **reword**: **not implemented**.
- **drop**: **not implemented**.
- **split**: **not implemented**.

`fixup` is implemented even though it was not named in the requested vocabulary. Reword/drop/split must be added as real backend + TypeScript + tray operations before they are advertised; they must not be simulated only in UI state.

## Edge-case qualification added in Phase 36

Real disposable Git fixtures now cover these requested hardening cases:

1. **Rebase across a merge commit** fails closed with `invalid-rewrite-range` and the user-visible message that merge commits are unsupported by the linear rewrite preview.
2. **Squash including the root commit** fails closed before rewrite because the requested list cannot equal the branch range above its required `onto` base.
3. **Reorder across a file-rename dependency chain** produces a structured Git/conflict failure when dependency order is broken; the original repository is byte-for-byte unchanged by the preview helper.
4. **Drop of a dependency-introducing commit** is intentionally not claimed as tested because `drop` does not yet exist. It is a required acceptance fixture for the phase that implements `drop`.

## Visualization semantics

Phase 36 adds a preview-to-viewport seam without manufacturing graph authority:

- sandbox preview evidence is retained in App state;
- changed refs, before/after OIDs, rewritten old/new OIDs, and hash-cascade parent OIDs are mapped to the graph identity forms that may already exist in the authoritative live dataset;
- affected 3D node descriptors receive an emissive/scale preview decoration;
- camera-projected node labels expose `data-mutation-affected` and an accessible `affected by mutation preview` suffix;
- a polite live region announces preview success/conflict and the number of visible affected graph nodes.

This is **not yet a complete transformed-topology preview**. Newly created rewritten commit nodes are not inserted into the live repository dataset merely because the sandbox reports their OIDs. A future backend contract must provide a bounded post-preview graph delta/snapshot if the studio is to render newly created objects and edges authoritatively.

## Undo / redo semantics

Undo/redo is now available for the ordered mutation **draft**. Stage, move, and remove operations create bounded history entries; undo and redo invalidate any stale sandbox preview before changing the draft. A new edit after undo clears redo history.

There is still no original-repository apply, therefore there is no claim of undoing a mutation after original execution. Preview confirmation remains acknowledgement of a disposable result and destroys/cleans up its sandbox according to the existing preview lifecycle.

## Accessibility

Mutation hardening preserves the Phase-35 viewport accessibility authority and extends it:

- roving keyboard traversal and selection `aria-pressed` states remain unchanged;
- mutation draft edits receive polite, atomic live announcements;
- preview success/conflict has a viewport live-status summary;
- affected projected nodes have an explicit screen-reader label suffix;
- a failed/conflicting preview cannot expose the `Confirm preview only` control.

## Performance authority

The Phase-36 pre-change clean-baseline release gate verified:

- graph-elements: 48/48 tests;
- app: 139/139 tests before Phase-36 additions;
- initial application JS: 348.87 kB minified / 104.39 kB gzip, below the <1 MB initial-bundle target;
- deferred `GraphScene`: 1,034.30 kB minified / 280.95 kB gzip;
- 1k/10k/100k scale instrumentation green, with 100k projecting 224 render nodes / 533 render edges.

These benchmark tests are CPU/planning instrumentation and **do not claim GPU FPS**. Final Phase-36 qualification must rerun the release/build gate after the new visualization seam and compare startup bundle size and scale instrumentation again.

## Next implementation tranche

1. Add real preview operation contracts and backend semantics for **reword**, **drop**, and **split**.
2. Add dependency-aware drop fixtures, including a commit that introduces a file later consumed/renamed by descendants.
3. Define a bounded authoritative post-preview graph delta so newly created rewritten commits/edges can be rendered, not merely existing affected identities highlighted.
4. Preserve the original-apply NO-GO boundary unless a separate safety program closes the existing whole-source TOCTOU authority gap.
