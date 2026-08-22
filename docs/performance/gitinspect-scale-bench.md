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

The native refresh API currently rebuilds a complete snapshot after a coalesced filesystem change. The “changed refresh” number therefore measures the implemented full-refresh seam, not an incremental/delta algorithm.

## Reproduction

From the repository root:

    cargo build --release --manifest-path crates/gitinspect-core/Cargo.toml --example scale_bench
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 1000
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 10000
    /usr/bin/time -v crates/gitinspect-core/target/release/examples/scale_bench 100000

The executable emits one JSON object on stdout. GNU time writes CPU/RSS evidence on stderr. Generated repositories are repository-local and deterministic; rerunning a size replaces only its own generated fixture directory.

For app-local index/search/LOD instrumentation:

    pnpm --filter @gitinspect/app exec vitest run src/scale/benchmark.test.ts

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

### App-local search/index/LOD

The existing deterministic app benchmark was rerun in the same checkout. Its memory accounting for `GitSearchIndex` is conservative index-owned accounting, while the GNU-time process HWM includes Vitest, V8, all three generated datasets, layout/search work, and runner overhead.

| logical commits | cold search index | exact query | scale total | render nodes/edges | estimated search index |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 15.22 ms | 1.48 ms | 33.40 ms | 25 / 30 | 821,422 B |
| 10,000 | 96.49 ms | 5.64 ms | 83.84 ms | 18 / 12 | 8,227,234 B |
| 100,000 | 686.58 ms | 54.78 ms | 821.53 ms | 17 / 12 | 82,645,830 B |

The 100k bounded fuzzy probe took 20.41 ms, stopped at exactly 16,384 token comparisons after 1,371 documents, returned 16 hits, and reported `truncated=true`. The whole three-size Vitest command used 3.98 s user CPU + 0.38 s system CPU in 3.00 s wall time and reached 606,468 KiB maximum RSS; that HWM is deliberately **not** presented as the search index's memory usage.

### Current evidence bounds

The present implementation qualifies on this host with these evidence bounds: metadata-only native snapshot open and one-change refresh below 1 s at 100k; native IPC envelope below 40 MiB at 100k; native benchmark max RSS below 160 MiB at 100k; app cold index and scale projection below 1 s at 100k; fuzzy work bounded by configured document/token ceilings. Structural regression tests avoid fragile machine-specific timing assertions but pin deterministic history identity, metadata-only loading, unchanged-refresh equivalence, and a 512 kB maximum payload for the 1k fixture.

## Actionability rules

1. Do not raise the product snapshot limit from its current default solely because the core can walk 100k commits. Tauri open/refresh currently use `OpenOptions::default()` (`max_commits=50_000`), and payload/latency evidence must justify any product-limit change.
2. If JSON payload growth becomes operationally large, prefer a bounded/paged or compact snapshot transport over eager diff/blob hydration.
3. If unchanged/+1 refresh remains close to cold-open cost, the measured bottleneck justifies a future revision-aware delta/cache seam; do not call the present full refresh “incremental.”
4. Search/index performance belongs to the app-local `GitSearchIndex`. Its current 100k evidence includes conservative owned-byte accounting and explicit fuzzy document/token budgets; native Rust snapshot timing is a separate layer.
