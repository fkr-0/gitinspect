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

The legacy native refresh API rebuilds a complete snapshot after a coalesced filesystem change. Phase 2 adds an opt-in compact Tauri transport whose refresh path first recomputes the existing revision-defining HEAD/ref/remote/hook metadata. An unchanged revision returns only an `unchanged` status plus the revision and skips the commit walk; a changed revision still falls back to the complete metadata-only snapshot. This is a revision-aware unchanged cache, not a general commit delta algorithm.

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

The changed-revision path is deliberately conservative. A +1 commit still performs the existing O(N) metadata walk before compact encoding; the post-change legacy comparison measured ~658.96 ms for that full rebuild. Phase 2 does **not** claim an incremental +1 refresh win. A future append-aware delta/cache stage would need an explicit ancestry/cursor contract and deterministic divergence handling before replacing that fallback.

### App-local search/index/LOD

The existing deterministic app benchmark was rerun in the same checkout. Its memory accounting for `GitSearchIndex` is conservative index-owned accounting, while the GNU-time process HWM includes Vitest, V8, all three generated datasets, layout/search work, and runner overhead.

| logical commits | cold search index | exact query | scale total | render nodes/edges | estimated search index |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 15.22 ms | 1.48 ms | 33.40 ms | 25 / 30 | 821,422 B |
| 10,000 | 96.49 ms | 5.64 ms | 83.84 ms | 18 / 12 | 8,227,234 B |
| 100,000 | 686.58 ms | 54.78 ms | 821.53 ms | 17 / 12 | 82,645,830 B |

The 100k bounded fuzzy probe took 20.41 ms, stopped at exactly 16,384 token comparisons after 1,371 documents, returned 16 hits, and reported `truncated=true`. The whole three-size Vitest command used 3.98 s user CPU + 0.38 s system CPU in 3.00 s wall time and reached 606,468 KiB maximum RSS; that HWM is deliberately **not** presented as the search index's memory usage.

### Current evidence bounds

The present implementation qualifies on this host with these evidence bounds: metadata-only native snapshot open and one-change fallback refresh below 1 s at 100k; active compact native IPC envelope below 13 MiB at 100k while the preserved legacy envelope remains ~34.51 MiB; isolated compact process HWM below 90 MiB at 100k; unchanged revision validation below 1 ms on the qualification fixture; app cold index and scale projection below 1 s at 100k; fuzzy work bounded by configured document/token ceilings. Structural regression tests avoid fragile machine-specific timing assertions but pin deterministic history identity, metadata-only loading, exact compact round-trip, compact payload less than half the legacy 1k JSON, unchanged revision short-circuiting, and the original 512 kB maximum legacy payload for the 1k fixture.

## Actionability rules

1. Do not raise the product snapshot limit from its current default solely because the core can walk 100k commits. Tauri compact open/refresh still use `OpenOptions::default()` (`max_commits=50_000`), and this stage intentionally does not change that product bound.
2. Keep the compact transport metadata-only. Eager diff/blob hydration is explicitly rejected by the encoder; deeper inspection stays on the separately bounded lazy commit-diff path.
3. Do not call Phase 2 a general incremental refresh. Unchanged revisions short-circuit before the commit walk, but changed revisions intentionally fall back to a complete metadata snapshot. An append-aware or paged delta contract remains a future seam.
4. Search/index performance belongs to the app-local `GitSearchIndex`. Its current 100k evidence includes conservative owned-byte accounting and explicit fuzzy document/token budgets; native Rust snapshot timing is a separate layer.
