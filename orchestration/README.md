# Orchestration prompt index

These prompts are retained as historical execution contracts, not as a live job queue.
The durable work identity for current hardening is the operator-control-plane (OCP)
task ID. Coordinate shared-checkout work through ws-bridge presence, notes and
path claims. Do not create legacy `next.md` dispatch records, and do not edit
`CHANGELOG.md` from a worker slice; propose Unreleased notes to the coordinator.

| Phase | Prompt files | Status |
| --- | --- | --- |
| Phase 3 — foundations | `gitinspect-[a-e]-*.md` | Superseded by later integrated implementation; historical reference only |
| Phase 4 — native integration | `gitinspect-phase4-*.md` | Superseded by landed graph, visualization and IPC integration |
| Phase 5 — product interactions | `gitinspect-phase5-*.md` | Superseded as dispatch instructions; retain requirements and historical context |
| Hardening 01 — R3F/WASM | `gitinspect-hardening-01-*.md` | Historical completed-fix brief; validate landed implementation before follow-up |
| Hardening 02 — runtime | `gitinspect-hardening-02-*.md` | Active/recent OCP scope; check task state before acting |
| Hardening 03 — untrusted data | `gitinspect-hardening-03-*.md` | Active/recent OCP scope; check task state before acting |
| Hardening 04 — browser backend | `gitinspect-hardening-04-*.md` | Active/recent OCP scope; owns `docs/WEBASSEMBLY.md` |
| Hardening 05 — cleanup | `gitinspect-hardening-05-*.md` | This cleanup contract; current OCP task is canonical |
| Hardening 06 — toolchain | `gitinspect-hardening-06-*.md` | Active/recent OCP scope; owns dependency/toolchain upgrades |

A superseded prompt is **not** evidence that its implementation was completed.
Consult the current Git history, release evidence, OCP status and live claims.
Historical prompts remain tracked so prior decisions are auditable.
