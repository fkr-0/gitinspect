# GitInspect initial public release roadmap

Status: **proposed public-release runway after the local `v0.2.0` baseline**

## Release interpretation

`v0.2.0` is already the tagged local release baseline. It should remain immutable. The repository has continued to gain release tooling and regression coverage after that tag, so the clean public-release path is a new patch release rather than moving or replacing `v0.2.0`.

Recommended target: **`v0.2.1` as the first public packaged desktop release**.

The target scope is intentionally narrow:

- ship the existing read-only repository inspection and Git Railfield experience;
- ship copy-only mutation previews;
- keep original-repository mutation apply **NO-GO/unavailable**;
- establish one reproducible packaged Linux artifact lane first;
- document macOS/Windows packaged execution as unqualified until independently exercised;
- do not couple publication, push, deploy, or tag creation to local release gates.

## Definition of done

A public release candidate is ready only when all gates below are green at one immutable commit:

```text
source/candidate metadata
        |
        v
release:verify ------------------------+
        |                              |
        v                              |
release:native-qualify (Linux X11/i3)  |
        |                              |
        +------------+-----------------+
                     v
          release:package-qualify
                     |
                     v
        packaged AppImage + manifest
        + packaged read-only runtime smoke
                     |
                     v
          docs + compatibility matrix
                     |
                     v
          explicit publication action
```

No gate in this chain grants original-repository mutation authority.

## Roadmap

### R0 — freeze the release contract

**Goal:** turn the current strong implementation into a small, explicit product promise.

Exit criteria:

- `v0.2.0` remains untouched as historical/local baseline;
- next candidate version is chosen as `0.2.1`;
- `CHANGELOG.md`, Tauri, Rust core, and frontend versions agree;
- supported capability is phrased as inspection + copy-only preview, not destructive apply;
- known fidelity limits stay visible rather than being silently promoted to blockers.

### R1 — qualify the actual Linux package

**Goal:** make the distributable artifact itself part of release authority.

Implemented release seam:

- `pnpm release:package-audit-test` adversarially tests the artifact auditor;
- `pnpm release:package-qualify` runs the full candidate gate, builds a Linux AppImage, audits product/version/hash/size/executable provenance, and executes the packaged binary in a bounded read-only repository smoke mode;
- default package qualification rejects a dirty worktree;
- `--allow-dirty-diagnostic` may be used during development, but records `releaseQualified=false` and must never be cited as release acceptance;
- package-build failures are separated from environment prerequisites, with machine-readable evidence retained under `.git/`.

Current diagnostic finding (2026-09-08): the full candidate suite, optimized release build, AppImage assembly, artifact audit, and packaged bounded repository smoke are green in dirty-diagnostic mode. The produced executable AppImage was 107,833,848 bytes and the packaged smoke reported `original_apply_authorized=false`. This proves the lane can produce and execute an artifact in the current environment, but it is deliberately **not** release acceptance because `--allow-dirty-diagnostic` records `releaseQualified=false`. The next acceptance step is a clean `pnpm release:package-qualify` at the frozen candidate commit.

The qualification harness now also treats its own filesystem operations as part of the release safety boundary: `--bundle-dir` is confined to a direct non-symlink child of the Tauri bundle directory before cleanup, `--summary` is confined to a direct non-symlink file in this worktree's Git metadata, and build logs survive packaging by being captured in a repository-local temporary runtime path before durable evidence is written under Git metadata.

Exit criteria for R1:

- clean candidate worktree;
- `pnpm release:package-qualify` returns `PASS` with `releaseQualified=true`;
- the emitted JSON summary and AppImage SHA-256 are retained with candidate evidence;
- packaged smoke opens a real repository through `gitinspect-core` and reports `original_apply_authorized=false`;
- Linux source/native GUI qualification remains a separate authority and is not inferred from the headless package smoke.

### R2 — release-facing UX and documentation

**Goal:** a new user can install, open a repository, understand the visualization, and understand the safety boundary without reading architecture notes.

Current state: the root README now documents source prerequisites, native/frontend run commands, the repository inspection flow, preview-only semantics, and the main verification commands. A dedicated long-form user guide and reusable package API reference remain follow-up consolidation rather than missing basic operator instructions.

Deliverables:

1. `docs/USER_GUIDE.md`
   - install/run;
   - open repository;
   - search, selection, camera/navigation, drill-down;
   - mutation preview lifecycle;
   - what confirmation does and does not do;
   - troubleshooting and scale expectations.
2. `docs/API_REFERENCE.md`
   - public graph/contracts exports actually intended for reuse;
   - stable identity and dataset contracts;
   - layout/LOD/interaction/transaction boundaries;
   - explicit non-public/internal surfaces.
3. First-run ergonomics review
   - repository-open failure copy;
   - empty/unborn repository state;
   - long-open progress behavior for large repositories.

The existing missing repository-open progress stream is a useful polish item. It should only gate `0.2.1` if real large-repository acceptance shows visible UI starvation; otherwise it can follow as `0.2.2` without delaying a safe first public package.

### R3 — compatibility claims, not compatibility guesses

**Goal:** publish only platforms with artifact-level evidence.

Initial public support recommendation:

| Platform | Initial claim | Required evidence |
| --- | --- | --- |
| Linux x86_64 | supported first | clean AppImage package qualification + existing Linux native runtime gate |
| macOS | experimental/unclaimed | produced `.dmg`/`.app`, launch/open/smoke evidence on macOS |
| Windows | experimental/unclaimed | produced MSI/NSIS artifact, launch/open/smoke evidence on Windows |

Do not make macOS/Windows blockers for the first Linux public release unless multi-platform day-one support is a product requirement. Instead, keep the compatibility matrix fail-closed and add each platform after its package is actually exercised.

### R4 — candidate cut and publication

**Goal:** convert one frozen green commit into a release without changing its bytes.

Order:

1. bump all product surfaces to `0.2.1` and add the dated changelog heading;
2. run `pnpm release:candidate`;
3. run `pnpm release:native-qualify` on the applicable Linux X11/i3 environment;
4. run clean `pnpm release:package-qualify`;
5. archive package summary, native summary, compatibility matrix, and checksums;
6. review `git diff --check`, status, and exact candidate commit;
7. create the local tag only under explicit release authorization;
8. configure remote and publish only under separate explicit push/release authorization.

The produced package must be built from the same commit that is tagged. Rebuilding after the tag is acceptable only if the new artifact receives fresh qualification and provenance; do not assume byte reproducibility unless it is measured.

## Deferred work after first public release

These are valuable but should not expand the first-release critical path without evidence that they block users:

- annotated-versus-lightweight tag fidelity;
- live remote fetch/push status;
- true dual-band merge-edge geometry;
- stronger signature verification presentation;
- macOS/Windows native package lanes;
- repository-open progress streaming if large-repository UX remains acceptable;
- any reconsideration of original-repository apply.

Original-repository apply is a separate safety architecture program, not a release checkbox. The current whole-source concurrency/TOCTOU result remains terminal for the present executor design.

## Release risk register

| Risk | Current control | Release action |
| --- | --- | --- |
| Source tests pass but installer is broken | packaged AppImage audit + packaged headless repository smoke | require clean `release:package-qualify` |
| Tauri packaging may depend on helper downloads on a fresh host | package gate classifies helper/network failure as `PREREQUISITE_UNAVAILABLE` and retains build-log hash; current host has exercised an end-to-end AppImage build | pre-provision/cache helpers or use an approved bundler mirror in release environments that cannot fetch them |
| Package cleanup/evidence paths escape the intended release workspace | bundle-dir and summary-path confinement reject outside/symlink targets; build output is captured before durable evidence copy | keep the confinement probes and package-auditor self-tests fail-closed |
| Existing `v0.2.0` tag no longer contains newest release work | immutable historical baseline | release new patch version; never move tag |
| Dirty local changes contaminate package | package gate defaults fail-closed on dirty status | no release qualification from diagnostic mode |
| GUI/native behavior inferred from headless package smoke | separate existing native X11/i3 gate | require both authorities for Linux claim |
| Cross-platform claims outrun evidence | compatibility matrix is explicit | add platforms only after packaged execution |
| Mutation preview is misread as destructive apply | UI/backend still expose no original apply path | preserve NO-GO language and tests |
| Publication mutates local release process | no remote is currently configured | keep push/tag/publish a separate authorized action |
