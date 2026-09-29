# gitinspect

gitinspect is a GPU-driven 3D visualization and mutation studio for Git repositories.
It is built as two layers:

- `@gitinspect/graph-elements`: a Git-agnostic framework for mapping graph-shaped data into explorable 3D worlds.
- `gitinspect`: a Tauri desktop application that maps Git objects, refs, history, and mutations onto graph-elements.

The desktop architecture deliberately separates **rendering** from **repository authority**: TypeScript/React Three Fiber owns the visual world and interaction model; Rust/gix owns filesystem access, repository parsing, watching, diff/stat extraction, and confirmed mutations.

## Development status

GitInspect 0.2.1 is the current public patch release. Real repository inspection, live refresh, the Git Railfield visualization, and copy-only mutation previews are qualified by the release gate. Original-repository mutation apply remains deliberately unavailable because the whole-source concurrency safety case is still NO-GO.

Published `v*` tags run the release candidate gate and build GitHub Release bundles for Linux x86_64, Windows x86_64, and macOS arm64/x86_64. Linux also has the repository's environment-sensitive native/AppImage qualification path; successful CI packaging on macOS and Windows is build/package evidence, not a claim of equivalent runtime qualification.

## Workspace

```text
apps/gitinspect/                 desktop/web UI
crates/gitinspect-core/          Git parsing, repository model, watcher, mutation authority
packages/graph-elements/         generic 3D graph framework
packages/contracts/              stable cross-layer TypeScript contracts
docs/                            specification, architecture, implementation plan
orchestration/prompts/           autonomous worker prompts
```

For the reusable in-repository TypeScript surface, see `docs/API_REFERENCE.md`. The contracts and graph-elements packages remain private workspace packages; this reference does not claim independent npm publication or standalone semantic-version support.

## Run from source

CI uses Node.js 24, pnpm 11.3.0, and stable Rust with `rustfmt` and `clippy`. Install the platform prerequisites required by Tauri as well; on Debian/Ubuntu the CI lane installs `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf` (plus the compiler/system utilities listed in `.github/workflows/ci.yml`).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @gitinspect/app exec tauri dev
```

For frontend-only development, without native repository authority:

```sh
pnpm --filter @gitinspect/app dev
```

The normal desktop flow is:

1. choose a local Git repository with the native repository picker;
2. inspect/search/select the rendered Git world and drill into commit/file detail;
3. let native filesystem watch events refresh the authoritative snapshot;
4. stage mutation-preview operations only when needed; previews execute in GitInspect-owned disposable copies;
5. treat preview confirmation as confirmation of the preview result only—there is no original-repository apply command.

## Development and release gates

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm lint
pnpm build
pnpm release:metadata-test
pnpm release:package-audit-test
pnpm release:package-harness-test
pnpm release:verify
pnpm release:candidate
```

`pnpm release:verify` is the display-independent regression gate across TypeScript, Rust core, Tauri, lint/build/tests, and whitespace checks. `pnpm release:candidate` additionally enforces release metadata: all four product version surfaces must agree, bundling must be enabled, and the changelog must contain the release heading. `pnpm release:package-harness-test` is the Linux AppImage harness regression gate; it proves interrupted qualification preserves the previous summary and cleans unpublished run state. `pnpm test:coverage` produces local V8 coverage reports for the app and graph-elements; CI uploads those reports as an artifact.

Linux i3/X11 native projection qualification and AppImage qualification are intentionally separate environment-sensitive authorities. Read `docs/RELEASE_CHECKLIST.md` before running `pnpm release:native-qualify` or `pnpm release:package-qualify`.

## Safety model

- Loading and inspection are read-only.
- Mutation requests build an explicit transaction and preview first.
- The default mutation target is a disposable repository copy/worktree.
- Original-repository apply is not exposed; confirming a preview never grants original-repository mutation authority.
- No background operation may silently invoke destructive Git actions.

See `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Experimental browser / WebAssembly edition

The normal product remains a Tauri desktop application with native Rust repository authority. A separate experimental browser entry now boots through a real Rust/WebAssembly module while deliberately retaining the deterministic synthetic repository adapter; native `gix` parsing, filesystem watching, and mutation authority are **not** claimed in the browser boundary.

The proposed GitHub Pages site is documentation-first: `/` explains the architecture and safety model, then explicitly links to `/wasm/` for the experiment. See `docs/WEBASSEMBLY.md` and `.github/workflows/pages.yml` for the exact build/deployment contract.
