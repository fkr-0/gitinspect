# GitInspect 0.2.0 repository compatibility matrix

This document records release-oriented compatibility evidence already exercised by the automated GitInspect core and Tauri suites. It is deliberately narrower than a promise that every Git repository or desktop platform is supported.

Evidence refreshed on 2026-08-31 from tagged repository HEAD `fe697b8e6059b5c067b6407b584ac79bbfb83c5a` (`v0.2.0`), using Git 2.55.0, Rust 1.94.1, Node 24.18.0 and pnpm 11.3.0 on Linux. `pnpm release:candidate` passed the complete TypeScript, Rust-core and Tauri regression matrix plus converged 0.2.0 candidate metadata.

## Repository topology and HEAD state

| Repository shape / state | Release evidence | Status | Boundary |
| --- | --- | --- | --- |
| ordinary worktree root | generated fixture and opening GitInspect itself | qualified | read-only open/refresh authority |
| `.git` directory path | `opens_dot_git_linked_worktree_and_bare_repository_paths` | qualified | resolves back to canonical worktree |
| linked worktree root | same core integration test | qualified | canonical linked-worktree repository path retained |
| linked-worktree `.git` gitfile | same core integration test | qualified | `gitdir:` indirection resolved |
| bare repository | same core integration test using a local bare clone | qualified | inspection only; no worktree assumed |
| attached symbolic HEAD | `distinguishes_resolved_head_oid_from_symbolic_head_ref` | qualified | resolved object ID and `headRef` are separate authoritative fields |
| detached HEAD | same test | qualified | resolved object remains available while `headRef` is absent |
| unborn branch | `preserves_symbolic_head_for_an_unborn_branch` | qualified | no fabricated commit; symbolic `refs/heads/main` retained |
| truncated history | `opens_linear_history_and_serializes_contract_shape` and append-cursor tests | qualified | explicit `truncated=true`; bounded tail replacement on append |

## Git topology and metadata

| Feature | Evidence | Status | Known limitation |
| --- | --- | --- | --- |
| linear history | repository-service fixtures | qualified | metadata-first snapshot by default |
| divergence and merge commits | refs/topology fixture | qualified | visual merge edge remains single-color rather than dual-band |
| local branches | refs fixture | qualified | symbolic targets preserved where present |
| remote-tracking refs | refs fixture | qualified | no live network fetch/status operation |
| symbolic refs | `refs/heads/alias` fixture | qualified | inspection only |
| lightweight tags | refs fixture | qualified as tag ref | lightweight vs annotated is not yet a distinct frontend semantic class |
| annotated tags | refs fixture | qualified as tag ref | annotation payload/type fidelity remains limited |
| stash ref and `stash@{0}` | refs fixture | qualified | bounded snapshot semantics |
| packed refs | fixture runs `git pack-refs --all` | qualified | exercised together with object GC |
| remotes with multiple fetch URLs and push URL | refs fixture | qualified | URLs are local configuration data; no network access or fetch/push health status |
| upstream relation | configured `branch.main.remote/merge` fixture | qualified | reflects repository config; does not contact remote |
| hook-name enumeration | fixture `pre-commit` hook | qualified | hook bytes are not executed during inspection; mutation safety uses separate fingerprinting evidence |
| unsigned commit status | linear fixture | qualified | robust cryptographic signature verification may remain unknown/unsigned |

## Diff and content handling

| Content case | Evidence | Status | Boundary |
| --- | --- | --- | --- |
| text file additions/deletions/status | linear history fixture | qualified | bounded per-open diff options |
| lazy commit diff | `commit_diff_is_lazy_and_large_binary_content_is_not_materialized` | qualified | expensive content omitted from initial metadata snapshot |
| binary file metadata | same test | qualified | oversized binary body is not materialized |
| path-targeted text file detail | `commit_file_detail_is_path_targeted_and_patch_bounded` | qualified | hunk/line count bounded by server-owned limits |
| oversized text file | `commit_file_detail_returns_metadata_only_for_oversize_content` | qualified | returns `TooLarge`, metadata only, no unbounded blob transfer |
| frontend-requested diff/file bounds | Tauri `frontend_diff_options_can_only_tighten_server_bounds` | qualified | frontend cannot widen backend maxima |

## Refresh, scale and native bridge

| Behavior | Evidence | Status | Boundary |
| --- | --- | --- | --- |
| stable no-change structural revision | `snapshot_revision_is_stable_and_changes_when_refs_move` | qualified | structural revision is not an original-mutation freshness token |
| native filesystem watch | core `native_watch_reports_fixture_repository_changes` | qualified on Linux | platform-specific runtime behavior still needs packaged macOS/Windows evidence |
| Tauri `repository://changed` event provenance | native Tauri repository-command test | qualified | event does not mutate repository authority; refresh remains explicit |
| rapid linear append delta | core/Tauri append-aware tests | qualified | bounded append only when topology/ref assumptions hold |
| ref-set change fallback | core/Tauri delta tests | qualified | fails safely to full authoritative snapshot |
| rewritten/force-pushed history fallback | scale regression | qualified | append optimization rejected; full refresh required |
| 1,000-commit metadata snapshot | `thousand_commit_snapshot_stays_metadata_only_and_payload_is_linear` | qualified | JSON payload bounded below 512 KiB in deterministic fixture |
| compact IPC transport | compact round-trip regression | qualified | compact payload less than half legacy JSON in fixture |
| synthetic 10k/100k visualization scale | frontend benchmark/LOD suites | qualified as CPU/layout/search projection evidence | not a packaged GPU/FPS claim |

## Preview-only mutation compatibility

The mutation studio is intentionally separate from read-only repository compatibility. Automated copy-only/native-preview suites cover branch/tag operations plus cherry-pick, rebase-reorder, squash and fixup, including ordering, conflict reporting, stale revision rejection, cancellation and sandbox cleanup.

**Original-repository apply is not a supported compatibility mode.** Phase 31 demonstrated that the current execution architecture does not provide an external-writer-honored whole-source concurrency envelope. `FinalRepositoryToctou` therefore remains a terminal blocker and no release matrix entry may imply original apply support.

## Platform qualification boundary

Current automated repository compatibility is strongest on Linux. CI also compiles/tests the Rust and TypeScript layers on Ubuntu runners, but this matrix does **not** claim packaged desktop execution on macOS or Windows. Tauri bundling is enabled for the 0.2.0 baseline; each platform still requires a produced-artifact smoke test before packaged execution on that platform can be marked release-qualified.

The experimental browser/WebAssembly edition uses synthetic repository provenance and is not evidence for native repository compatibility.
