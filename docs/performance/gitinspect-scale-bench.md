# Gitinspect scale benchmark evidence

This document defines the reproducible Phase-5 scale evidence for the native repository boundary. It complements the app-local `apps/gitinspect/src/scale/benchmark.test.ts` instrumentation; it does not reinterpret CPU timings as GPU/FPS evidence.

## What is measured

- deterministic real Git histories generated with `git fast-import` under `crates/gitinspect-core/target/scale-bench/`;
- `gitinspect-core` metadata-only snapshot construction at 1k, 10k, and 100k commits;
- JSON serialization time and byte size as the concrete shape crossing the Tauri serde/IPC boundary;
- unchanged refresh and one-appended-commit refresh latency;
- process RSS/high-water RSS from Linux `/proc/self/status`;
- whole-command user CPU, system CPU, elapsed wall time, and maximum RSS with `/usr/bin/time -v`;
- the existing app-local search/index/LOD benchmark for bounded index/search behavior.

The legacy native refresh API rebuilds a complete snapshot after a coalesced filesystem change. Phase 2 adds an opt-in compact Tauri transport whose refresh path first recomputes the existing revision-defining HEAD/ref/remote/hook metadata. An unchanged revision returns only an `unchanged` status plus the revision and skips the commit walk; a changed revision still falls back to the complete metadata-only snapshot. Phase 3 adds a separate additive append-aware command that may return a compact commit delta only when an explicit cursor proves a bounded linear append; every other changed-revision case retains the authoritative full-snapshot fallback.

## Reproduction

From the repository root:

    cargo build --release --manifest-path crates/gitinspect-core/Cargo.toml --example scale_bench
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 1000
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 10000
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 100000

The executable emits one JSON object on stdout. GNU time writes CPU/RSS evidence on stderr. Generated repositories are repository-local and deterministic; rerunning a size replaces only its own generated fixture directory.

For app-local index/search/LOD instrumentation:

    pnpm --filter @gitinspect/app exec vitest run src/scale/benchmark.test.ts

For the isolated compact-transport/RSS path (same deterministic fixtures, without allocating the legacy JSON envelope in the same process):

    crates/gitinspect-core/target/release/examples/scale_bench 1000 --compact-only
    crates/gitinspect-core/target/release/examples/scale_bench 10000 --compact-only
    crates/gitinspect-core/target/release/examples/scale_bench 100000 --compact-only

## Invariants

- benchmark snapshots set `include_commit_files=false` and assert every commit `files` vector is empty;
- 100k history therefore does not eagerly materialize diffs or blobs;
- generated commit content, identity, timestamps, ancestry, and branch are deterministic for a commit count;
- the Rust regression suite checks deterministic history identity and a linear metadata-only payload bound at 1k;
- app fuzzy search remains hard-bounded by explicit document/token budgets and result limits.

## Qualification results

Qualified on 2026-08-23 from shared checkout HEAD `5e7dee580a2d39acf2383335628a2bb3d9145c8f` while preserving unrelated concurrent dirty work. Host fingerprint: Linux 7.1.8-arch1-3 x86_64, Intel Core i9-13900H, 31.0 GiB RAM, rustc 1.94.1, Git 2.55.0, Node 24.18.0, pnpm 11.3.0. Timings are machine/load dependent and are evidence rather than universal service-level guarantees.

### Native Git snapshot / IPC envelope

| commits | fixture gen | snapshot open | snapshot JSON | IPC envelope JSON | IPC payload | unchanged refresh | +1 commit refresh | max RSS | user CPU | system CPU | whole wall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 22.23 ms | 7.16 ms | 0.41 ms | 0.27 ms | 360,430 B | 6.50 ms | 10.15 ms | 9.79 MiB | 0.04 s | 0.01 s | 0.05 s |
| 10,000 | 140.64 ms | 63.88 ms | 3.16 ms | 2.82 ms | 3,609,432 B | 62.50 ms | 62.89 ms | 19.38 MiB | 0.33 s | 0.04 s | 0.34 s |
| 100,000 | 1,273.31 ms | 673.04 ms | 24.98 ms | 23.74 ms | 36,189,434 B | 670.41 ms | 665.71 ms | 131.27 MiB | 3.38 s | 0.37 s | 3.37 s |

The 100k IPC envelope is about 34.51 MiB and payload density stays near 362 bytes/commit. At 100k the process was about 58.15 MiB RSS immediately after cold snapshot construction and 94.79 MiB while holding the serialized IPC envelope; the 131.27 MiB high-water mark occurs while refresh temporarily holds old/new metadata snapshots. Every 1k/10k/100k snapshot and refresh asserted empty commit `files` vectors.

Repeated 100k fixture generation produced the same initial HEAD `2c71fd5946a3ceefb54e1a8ace408311772fbedc` and revision `sha256:5e66654451511104676a31a41c90802758c1e50ee86246adc51104b681787cfc`; the regression suite independently compares two deterministic generated histories.

### Phase 2 compact transport + revision-aware unchanged refresh

Phase 2 keeps `GitRepositorySnapshot` as the public application contract and keeps the legacy `open_repository` / `refresh_repository` Tauri commands registered. The native app bridge opts into additive `open_repository_compact` / `refresh_repository_compact` commands. Compact commit metadata is encoded as positional tuples plus a snapshot-local string table; refs/remotes/hooks retain their existing records. The decoder reconstructs the exact public snapshot shape. Compact encoding rejects any snapshot containing eager commit file lists, so commit diff/blob detail remains on the existing separately bounded lazy IPC path.

Qualified on 2026-08-23 from Phase-2 working state based on commit `325fcb1`. The release benchmark was rerun after the implementation, and the 100k deterministic HEAD/revision exactly matched Phase 1.

| commits | compact conversion | compact JSON | compact IPC payload | bytes/commit | legacy payload | payload reduction | unchanged revision check | compact process HWM |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0.36 ms | 0.11 ms | 121,913 B | 121.9 B | 360,430 B | 66.2% | 0.23 ms | 7.05 MiB |
| 10,000 | 4.29 ms | 0.99 ms | 1,252,919 B | 125.3 B | 3,609,432 B | 65.3% | 0.30 ms | 14.02 MiB |
| 100,000 | 51.07 ms | 9.26 ms | 12,922,925 B (~12.32 MiB) | 129.2 B | 36,189,434 B (~34.51 MiB) | 64.3% | 0.38 ms | 86.13 MiB |

The same post-change 100k legacy comparison produced 36,189,434 B, ~662.79 ms unchanged full refresh, and 130.19 MiB process HWM. The compact run therefore cuts the 100k serialized session by ~64.3% (2.80× smaller), cuts process HWM by ~33.8% in the same qualification rerun (86.13 vs 130.19 MiB; ~34.4% versus the original Phase-1 131.27 MiB HWM), and reduces unchanged refresh validation from ~662.79 ms to ~0.38 ms (>1,700× on this run). Snapshot construction itself remains intentionally unchanged: compact 100k cold open was ~665.94 ms versus ~654.96 ms in the comparison rerun.

Compact encoding is not free: the 100k native conversion plus compact serialization cost ~60.33 ms versus ~34.69 ms to serialize the legacy session. The trade is an additional ~25.6 ms of native encoding work for a ~22.17 MiB smaller IPC document and lower transport-side peak memory. Actual WebView IPC/JSON parse transfer time is not claimed by this benchmark.

The Phase-2 changed-revision path is deliberately conservative. A +1 commit still performs the existing O(N) metadata walk before compact encoding; the post-change legacy comparison measured ~658.96 ms for that full rebuild. Phase 2 does **not** claim an incremental +1 refresh win.

### Phase 3 bounded append-aware delta refresh

Phase 3 keeps every Phase-2 and legacy command available and adds `refresh_repository_compact_delta`. The current native app bridge opts into this additive command. Repository authority now stores a compact refresh cursor containing the base revision/HEAD/HEAD-ref, sorted ref/remote/hook metadata, snapshot count/truncation, and the exact `OpenOptions` commit bound. No commit payload is cached in native authority.

The delta path is intentionally narrower than “changed refresh is incremental.” It is eligible only when all of the following are true:

- the base snapshot is metadata-only, attached to a named HEAD, and visibly linear;
- all base ref targets are represented in that snapshot, making the preserved rev-walk ordering unambiguous;
- `OpenOptions` still match the cursor and the product-side default remains `max_commits=50_000`;
- HEAD advances while the same HEAD ref is the only changed ref record; remotes and hooks are unchanged;
- the new HEAD reaches the cursor HEAD through a single-parent chain within the hard 4,096-commit delta ceiling;
- revision metadata is re-read after the bounded object walk and still matches, so a concurrent ref move cannot publish a stale delta.

Detached/unborn state, merges, ref additions/removals/moves outside HEAD, force-push/divergence, an option mismatch, an advance beyond 4,096 commits, malformed/missing objects, or any ambiguous base all fail closed to the existing full metadata snapshot. The frontend additionally validates the explicit `baseRevision` and `baseHead`, unchanged HEAD-ref identity, linear parent chain, drop count, and HEAD-ref target before reconstructing the unchanged public `GitRepositorySnapshot` shape. The compact commit batch still rejects eager file lists; Phase-13 file detail remains separately lazy and bounded.

Qualified on 2026-08-23 against the same deterministic histories. The delta payload column is the exact serialized Tauri response shape (`status=delta` plus explicit base revision/head, new revision/head/ref, compact commit batch, refs/remotes/hooks, drop count, and truncation flag), not only the appended commit tuple.

| commits | Phase-2 compact full payload | Phase-3 +1 delta payload | current full +1 refresh | Phase-3 +1 delta refresh | delta conversion | delta JSON | Phase-3 process HWM |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 121,913 B | 779 B | 12.72 ms | 0.69 ms | 0.004 ms | 0.006 ms | 7.16 MiB |
| 10,000 | 1,252,919 B | 779 B | 68.45 ms | 0.68 ms | 0.003 ms | 0.005 ms | 14.24 MiB |
| 100,000 | 12,922,925 B (~12.32 MiB) | 779 B | 822.60 ms | 0.72 ms | 0.004 ms | 0.007 ms | 85.45 MiB |

The 100k append fast path is therefore roughly three orders of magnitude lower latency than both the measured Phase-2 full changed refresh (~658.96 ms) and the same-checkout full rerun under current load (822.60 ms), while avoiding retransmission of the ~12.32 MiB compact full snapshot. The current full rerun reached 130.58 MiB HWM; the final append-aware replay remained 85.45 MiB HWM. Cold snapshot construction is intentionally unchanged (695.38 ms in the final Phase-3 100k replay), so this result is specifically a bounded linear-append refresh improvement rather than a reworked native history walk.

The 1k/10k/100k append runs all returned exactly one commit and `dropCommitCount=0`. A separate real-Git regression opens 128 commits through a 64-commit bound, appends one commit, verifies `dropCommitCount=1`, applies the delta, and requires exact equality with an independently rebuilt authoritative full snapshot. Additional regressions require a new ref and rewritten/force-pushed history to return the full-snapshot variant. The Tauri authority test also verifies a successful linear delta, stale expected-revision rejection, and full fallback after a ref-set change.

### App-local search/index/LOD

The existing deterministic app benchmark was rerun in the same checkout. Its memory accounting for `GitSearchIndex` is conservative index-owned accounting, while the GNU-time process HWM includes Vitest, V8, all three generated datasets, layout/search work, and runner overhead.

| logical commits | cold search index | exact query | scale total | render nodes/edges | estimated search index |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 15.22 ms | 1.48 ms | 33.40 ms | 25 / 30 | 821,422 B |
| 10,000 | 96.49 ms | 5.64 ms | 83.84 ms | 18 / 12 | 8,227,234 B |
| 100,000 | 686.58 ms | 54.78 ms | 821.53 ms | 17 / 12 | 82,645,830 B |

The 100k bounded fuzzy probe took 20.41 ms, stopped at exactly 16,384 token comparisons after 1,371 documents, returned 16 hits, and reported `truncated=true`. The whole three-size Vitest command used 3.98 s user CPU + 0.38 s system CPU in 3.00 s wall time and reached 606,468 KiB maximum RSS; that HWM is deliberately **not** presented as the search index's memory usage.

### Current evidence bounds

The present implementation qualifies on this host with these evidence bounds: metadata-only native snapshot open and authoritative full changed fallback below 1 s at 100k; active compact native IPC envelope below 13 MiB at 100k while the preserved legacy envelope remains ~34.51 MiB; an eligible exact +1 append delta below 1 KiB and 1 ms at 1k/10k/100k; isolated compact/delta process HWM below 90 MiB at 100k; unchanged revision validation below 1 ms on the qualification fixture; app cold index and scale projection below 1 s at 100k; fuzzy work bounded by configured document/token ceilings. Structural regression tests avoid fragile machine-specific timing assertions but pin deterministic history identity, metadata-only loading, exact compact round-trip, exact append reconstruction including truncated-tail eviction, fail-closed divergence/ref-set fallback, compact payload less than half the legacy 1k JSON, unchanged revision short-circuiting, and the original 512 kB maximum legacy payload for the 1k fixture.

## Actionability rules

1. Do not raise the product snapshot limit from its current default solely because the core can walk 100k commits. Tauri compact open/refresh still use `OpenOptions::default()` (`max_commits=50_000`), and this stage intentionally does not change that product bound.
2. Keep the compact transport metadata-only. Eager diff/blob hydration is explicitly rejected by the encoder; deeper inspection stays on the separately bounded lazy commit-diff path.
3. Do not generalize the Phase-3 result into “changed refresh is incremental.” Phase 2 unchanged revisions short-circuit before the commit walk; Phase 3 adds only a bounded, validated linear-append fast path. Merges, ref-set changes, force-push/divergence, detached/ambiguous state, cursor/option mismatches, and oversized advances still use the complete metadata snapshot fallback.
4. Search/index performance belongs to the app-local `GitSearchIndex`. Its current 100k evidence includes conservative owned-byte accounting and explicit fuzzy document/token budgets; native Rust snapshot timing is a separate layer.
