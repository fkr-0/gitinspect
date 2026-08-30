# GitInspect 0.2.x release readiness

This checklist is the fail-closed Phase-6 release contract for the desktop product. It does not authorize a tag, push, publication, GitHub release, deployment, or original-repository mutation capability.

## Canonical release unit

The 0.2.x product release unit is the Tauri desktop application plus `gitinspect-core` at one repository revision. `@gitinspect/contracts` and `@gitinspect/graph-elements` are private workspace implementation packages and are not independently published by this release. The current tagged local baseline is `v0.2.0`.

Canonical version sources today:

- `apps/gitinspect/src-tauri/tauri.conf.json` — product version;
- `apps/gitinspect/src-tauri/Cargo.toml` — desktop crate version;
- `crates/gitinspect-core/Cargo.toml` — core crate version;
- `apps/gitinspect/package.json` — frontend package version, which must match before a release candidate is cut.

## Reproducible local gates

Use:

```sh
pnpm release:verify
```

This runs the complete TypeScript build/test/typecheck/lint matrix, Rust core fmt/clippy/tests, Tauri fmt/clippy/tests/check, and `git diff --check`. Verify mode reports release-candidate metadata without enforcing it. This generic regression gate is independent of i3/X11 and remains the cross-platform release verification entry point.

For the Linux i3/X11 native GPU/projection qualification lane, also use:

```sh
pnpm release:native-qualify
```

That operator gate is deliberately environment-sensitive and fail-closed. Its applicability lane is explicitly `linux-x11-i3`: a non-Linux platform reports `NOT_APPLICABLE`, while a Linux host lacking DISPLAY/i3/X11 focus authority reports `PREREQUISITE_UNAVAILABLE`; both return non-zero rather than manufacturing native evidence. This lane is not an unconditional macOS/Windows packaging prerequisite. When applicable, it creates only a previously absent controlled i3 workspace, refuses to reuse/steal an existing workspace, rejects competing native/cargo/browser-headed Gitinspect runners, waits for the exact native GraphScene/WebGL convergence marker, permits at most one external Tauri handoff per run, records X11 active-window/window-class/workspace plus strict native focus/selection evidence, and requires at least three serialized green runs. It restores the operator's original workspace afterward. Browser hardware-WebGL remains supplemental (`nativeFpsClaim=false`), and AT-SPI/native accessibility-tree qualification remains a separate read-only boundary.

`pnpm release:native-gate-test` is desktop-independent. In addition to exact executable/argv provenance regressions, it sends both TERM and INT through the production cleanup trap against gate-owned dummy native, monitor, and server process trees using repository-local runtime state and kernel-assigned loopback ports. Native/monitor cleanup remains the non-`setsid` exact PID/descendant branch; the server remains the owned process-group branch, but that branch enumerates group members and signals only exact PID/start-time identities present in its pre-signal snapshot rather than issuing an unbounded negative-PGID signal. Hostile fixtures inject a stale start-time identity plus late non-group and same-group descendants and require every out-of-snapshot identity to survive until its parent fixture performs separate exact cleanup. The test also runs native applicability with `jq` genuinely absent from a reduced PATH: applicable Linux reports non-zero `PREREQUISITE_UNAVAILABLE`, while simulated Darwin remains non-zero `NOT_APPLICABLE`; neither missing JSON reporting nor unsupported-platform classification can become success. The ordinary applicable Linux/X11/i3 qualification still requires the complete tool set. A separately established loopback listener must retain the same process identity and remain reachable throughout child cleanup. The self-test never stops or reuses a pre-existing desktop/Vite listener to manufacture ownership. The desktop-sensitive native qualification is also serialized by a repository-local nonblocking advisory lock held for the complete qualification lifetime; a concurrent gate invocation fails closed as `PREREQUISITE_UNAVAILABLE` before workspace focus or native launch. This closes the preflight-to-launch race where two independent gate invocations could otherwise both observe zero runners before either created its Tauri client.

When preparing an actual candidate, use:

```sh
pnpm release:candidate
```

Candidate mode fails closed unless product/core/Tauri/frontend versions agree, Tauri bundling is enabled, and the changelog contains a versioned release heading.

On the current 0.2.0 baseline, `pnpm release:candidate` passes with all four product version surfaces at `0.2.0`, `bundle.active=true`, and the dated `0.2.0` changelog section present.

## Current 0.2.0 state

### Qualified product capability

- real local repository discovery/open/refresh through Rust/gix authority;
- compact snapshot/delta refresh with native filesystem watch provenance;
- deterministic Git Railfield visualization with fitted topology camera, canonical camera-projected labels, semantic picking and Git-aware LOD;
- search/filter/highlight across the authoritative logical graph;
- bounded nested commit/file/hunk/blob drill-down and URL/history restoration;
- preview-only multi-operation mutation studio for branch/tag and commit rewrite operations;
- deterministic native Tauri preview qualification for rewrite success/conflict/staleness/cancellation;
- synthetic 1k/10k/100k scale evidence, with 100,004 logical nodes reduced to a bounded rendered projection;
- original-repository mutation apply remains deliberately unavailable because the whole-source TOCTOU safety case is still NO-GO.

### Release blockers still open

1. **Packaged desktop artifact smoke is still missing.** Bundling is enabled and candidate metadata passes, but a produced installer/AppImage/bundle has not yet been exercised as the release artifact.
2. **Cross-platform packaged compatibility evidence is partial.** Linux repository/runtime evidence is strong, but packaged macOS/Windows execution remains unproven and must not be inferred from source-level CI.
3. **Documentation/API reference remains incomplete.** Architecture/specification/release safety docs are strong, but a concise user tutorial plus public API/reference surface for graph-elements/contracts still needs release-oriented consolidation.
4. **Remote publication is not configured in this checkout.** There is no Git remote, so push/GitHub release/Pages publication remains a separate operator-visible action rather than a local release-gate side effect.

The experimental browser/WebAssembly/GitHub Pages work is a separate, explicitly synthetic/browser provenance track. Its completion does not satisfy desktop packaging or native-repository release gates.

## Known non-blocking product limitations for 0.2.x

These may ship if documented and accepted; they are not reasons to weaken safety gates:

- annotated versus lightweight tag fidelity remains limited;
- remote fetch/push status is not modeled;
- merge edges are not true dual-band/two-color geometry;
- commit signature verification may remain unknown/unsigned when robust verification is unavailable;
- original-repository destructive apply remains disabled/NO-GO.

## Final candidate gate

Before creating any future local release tag or treating a commit as a new candidate, all of the following must be true:

- `pnpm release:candidate` passes from the candidate revision;
- expected source/release metadata diff is reviewed and no unrelated dirty work is absorbed;
- platform bundle production is enabled; any platform claimed as packaged-release-qualified must also have a produced artifact smoke test;
- changelog/version surfaces agree on the exact candidate version;
- compatibility and performance evidence are attached to the candidate;
- the Linux i3/X11 native qualification lane passes `pnpm release:native-qualify` before any native GPU/projection acceptance is claimed for that environment;
- original-apply authority is still absent unless a separately authorized safety decision changes it;
- tag/push/publish/deploy are performed only under separate explicit operator authorization.
