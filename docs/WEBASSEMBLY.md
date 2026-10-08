# GitInspect WebAssembly experiment

## Status

GitInspect now has an **experimental browser/WASM boundary**, but the native Rust core is not being misrepresented as browser-ready.

The first backend extraction milestone now lives in `crates/gitinspect-model`. It owns the serializable snapshot types, compact transport and append-aware delta logic, and exposes small read-only `ObjectSource` and `RefSource` traits. `gitinspect-core` re-exports the same types so native callers remain source-compatible. Both `gitinspect-model` and `gitinspect-wasm` compile for `wasm32-unknown-unknown`; this is a build qualification, **not** a working browser object database. A bounded `InMemorySource` adapter now accepts caller-supplied already-inflated object bodies and refs and implements the read-only source traits, rejecting pack/index reads. It does not yet verify object hashes. An initial pure `assemble_graph` function now parses already-inflated SHA-1 commit bodies with `gix-object`/`gix-hash`, projects parent edges/author/committer data and direct refs, and enforces hard traversal bounds. **This is a partial graph projection, not a native-equivalent snapshot:** annotated commit-tag peeling and packed-ref merge (loose refs override packed entries) are covered by bounded model tests; full HEAD/revision metadata, tree/file metadata, exact native traversal ordering, and native JSON equivalence remain unverified. Loose-object inflation, pack/index decoding, native-versus-in-memory full snapshot JSON fixture equivalence, repository picker, worker import, fixture browser smoke and ~10k-commit timing remain outstanding. The demo intentionally remains synthetic until these are independently verified.

The current split is deliberate:

| Capability | Desktop/Tauri | Browser/WASM experiment |
| --- | --- | --- |
| React/Three visualization | yes | yes |
| Git Railfield / search / selection / LOD | yes | yes |
| Rust code executing as WebAssembly | n/a | yes |
| Real repository parsing with `gix` | yes | **partial**; inflated commit parsing only, not a full repository backend |
| Filesystem watching | yes | **no** |
| Original-repository mutation authority | **not authorized** | **no** |
| Browser repository source | n/a | deterministic synthetic demo |

`crates/gitinspect-core` depends on native repository and watcher facilities (`gix`, `notify`) and therefore remains the desktop authority. The extracted `gitinspect-model` has neither native dependency; its source traits grant no file access by themselves. The browser experiment uses the small `crates/gitinspect-wasm` crate as a versioned Rust/WASM boundary. The WebAssembly module proves cross-language execution with a deterministic runtime fingerprint and publishes an explicit fail-closed capability record.

The WASM page will not silently fall back to a plain JavaScript claim if the module cannot load: the browser entry displays a startup failure instead.

## Local build

The generated bindings are build artifacts and are not committed.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked

CARGO_TARGET_DIR=target/wasm \
  cargo build --manifest-path crates/gitinspect-wasm/Cargo.toml \
  --release --target wasm32-unknown-unknown

mkdir -p apps/gitinspect/public/wasm
wasm-bindgen \
  target/wasm/wasm32-unknown-unknown/release/gitinspect_wasm.wasm \
  --out-dir apps/gitinspect/public/wasm \
  --target web \
  --no-typescript

pnpm --filter @gitinspect/app exec vite build --config vite.wasm.config.ts
```

The browser entry is `apps/gitinspect/wasm.html`; the dedicated build emits `apps/gitinspect/dist-wasm/wasm.html` plus hashed application assets and the generated `wasm/` runtime files.

## GitHub Pages layout

The Pages workflow assembles one static artifact:

```text
/
├── index.html       documentation-first landing page
├── styles.css
├── docs/            source Markdown documentation copies
└── wasm/
    ├── index.html   experimental GitInspect browser edition
    ├── assets/      Vite application chunks
    └── wasm/        wasm-bindgen JavaScript + .wasm binary
```

The root page intentionally does **not** auto-launch the application. It explains the architecture and safety boundary first, then links to `./wasm/`.

## GitHub Pages deployment boundary

`.github/workflows/pages.yml` uses the current GitHub Pages artifact deployment model. It builds the Rust/WASM module and application in CI, assembles the documentation site, uploads a Pages artifact, and deploys through the `github-pages` environment.

Before a live deployment is possible, the GitHub repository must exist, a remote must be configured, and Pages must use **GitHub Actions** as its publishing source. The local checkout currently has no Git remote, so creating or publishing the remote repository is a separate operator-visible action rather than something inferred from the filesystem checkout.

## Next meaningful WASM phase

The next substantial browser step is not more UI decoration. It is a browser-safe repository backend with an explicit storage abstraction, for example:

1. isolate pure repository-model/diff logic from native filesystem/watch concerns;
2. define a read-only object database interface suitable for memory or browser file handles;
3. qualify `gix` components that compile for `wasm32-unknown-unknown`, or introduce a constrained browser parser if they do not;
4. add explicit user-mediated browser file/directory import;
5. keep mutation authority unavailable until a separate browser transaction safety case exists.
