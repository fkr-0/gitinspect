# gitinspect

gitinspect is a GPU-driven 3D visualization and mutation studio for Git repositories.
It is built as two layers:

- `@gitinspect/graph-elements`: a Git-agnostic framework for mapping graph-shaped data into explorable 3D worlds.
- `gitinspect`: a Tauri desktop application that maps Git objects, refs, history, and mutations onto graph-elements.

The desktop architecture deliberately separates **rendering** from **repository authority**: TypeScript/React Three Fiber owns the visual world and interaction model; Rust/gix owns filesystem access, repository parsing, watching, diff/stat extraction, and confirmed mutations.

## Development status

GitInspect 0.2.0 is the current tagged local release baseline. Real repository inspection, live refresh, the Git Railfield visualization, and copy-only mutation previews are qualified by the release gate. Original-repository mutation apply remains deliberately unavailable because the whole-source concurrency safety case is still NO-GO.

## Workspace

```text
apps/gitinspect/                 desktop/web UI
crates/gitinspect-core/          Git parsing, repository model, watcher, mutation authority
packages/graph-elements/         generic 3D graph framework
packages/contracts/              stable cross-layer TypeScript contracts
docs/                            specification, architecture, implementation plan
orchestration/prompts/           autonomous worker prompts
```

## Commands

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm release:verify
pnpm release:candidate
```

`pnpm release:verify` is the display-independent regression gate across TypeScript, Rust core, Tauri, lint/build/tests, and whitespace checks. `pnpm release:candidate` adds fail-closed version/changelog/bundling metadata checks. Linux i3/X11 native projection qualification is intentionally separate and environment-sensitive; see `docs/RELEASE_CHECKLIST.md` before running `pnpm release:native-qualify`.

## Safety model

- Loading and inspection are read-only.
- Mutation requests build an explicit transaction and preview first.
- The default mutation target is a disposable repository copy/worktree.
- Applying to an original repository requires a separate explicit confirmation path.
- No background operation may silently invoke destructive Git actions.

See `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Experimental browser / WebAssembly edition

The normal product remains a Tauri desktop application with native Rust repository authority. A separate experimental browser entry now boots through a real Rust/WebAssembly module while deliberately retaining the deterministic synthetic repository adapter; native `gix` parsing, filesystem watching, and mutation authority are **not** claimed in the browser boundary.

The proposed GitHub Pages site is documentation-first: `/` explains the architecture and safety model, then explicitly links to `/wasm/` for the experiment. See `docs/WEBASSEMBLY.md` and `.github/workflows/pages.yml` for the exact build/deployment contract.
