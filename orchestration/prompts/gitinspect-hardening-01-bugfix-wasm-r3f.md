Set repo: gitinspect (local pwd: /home/user/code/gitinspect).

# Bugfix P0 — GitHub Pages WASM demo crashes seconds after load (duplicate React Three Fiber)

This is a shared checkout. FIRST read `$(/home/user/code/chatgpt-tooling/bin/prolong latest gitinspect)`, `docs/ARCHITECTURE.md`, `docs/WEBASSEMBLY.md`, `CHANGELOG.md`, current git status/log/diffs, and active ws-bridge presence/claims/notes. Treat landed code as authoritative. All shell through `run_workspace_command`. Never write bare `/tmp`. Preserve `.ws-bridge` runtime metadata and every unrelated or concurrent edit. No reset/clean/push/tag/publish/deploy/bulk-format. Dependencies: this checkout is shared, so NEVER run a plain `pnpm install` (it recreates duplicate React Three Fiber variants and breaks typecheck for every other worker); if `node_modules` is missing or stale use `pnpm install --frozen-lockfile` only, and run `node scripts/check-single-r3f.mjs` afterwards. CI is the authority: before reporting a gate as failing, confirm it fails on a frozen-lockfile install and not just in this shared tree. Original-repository mutation apply stays NO-GO; nothing here may widen repository authority.

## Verified symptom (reproduced 2026-10-08, headless Chromium against https://fkr-0.github.io/gitinspect/wasm/)

About 3.3 s after load an uncaught `Error: R3F: Hooks can only be used within the Canvas component!` is thrown from `assets/GraphScene-*.js`; React unmounts the tree and `document.body.innerText` is empty from ~5 s on. One 404 also occurs at ~1 s (identify the URL; likely a missing favicon/asset under the `base: "./"` path).

## Verified root cause

`@react-three/fiber@9.7.0` is installed **twice** in the pnpm store, differing only by the `@types/react` peer variant (19.2.14 vs 19.2.18). `apps/gitinspect` resolves the 19.2.18 copy; `packages/graph-elements` and `@react-three/drei` resolve the 19.2.14 copy. The production Rollup bundle therefore contains two R3F runtimes (the error string appears twice in `GraphScene-*.js`): `<Canvas>` creates context in one copy while `useThree`/`useFrame` read from the other.

## Objective

1. Make exactly one copy of react, react-dom, three, @react-three/fiber and @react-three/drei resolvable: unify `@types/react` to a single version (pnpm `overrides`/catalog), regenerate `pnpm-lock.yaml` minimally, and add `resolve.dedupe` for those packages in **both** `vite.config.ts` and `vite.wasm.config.ts`. The desktop (Tauri) production build is affected by the same duplication; verify it too.
2. Add a build-time guard (`scripts/check-single-r3f.mjs`, wired into `pnpm build`/CI) that fails if the emitted bundle contains more than one R3F runtime or if the lockfile resolves more than one fiber/three/react instance.
3. Add a headless-browser smoke test for the built `dist-wasm` (serve locally, load, wait 30 s, fail on any `pageerror`, console error, failed request or empty body; take a screenshot artifact). Wire it into `.github/workflows/pages.yml` **before** the deploy job so a broken demo can never be published.
4. Find and fix the 404.

## Evidence

Before/after: bundle copy count, smoke-test output, screenshots at 1 s / 12 s / 30 s. Include the failing run of the new guard against the pre-fix lockfile to prove it detects the bug.

## Owned scope

`apps/gitinspect/vite*.ts`, root `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` (dependency unification only), `scripts/check-single-r3f.mjs`, `scripts/wasm-smoke.mjs`, `.github/workflows/pages.yml`. Do not change app/graph-elements source unless the dedupe provably does not fix the error; if so post an exact proposal first.

Commit meaningful scoped slices locally (small, conventional messages). Do not edit `CHANGELOG.md`; post the commits, checks run, evidence and a proposed `## Unreleased` bullet to `.wsbridge:gitinspect`. At handoff (the legacy `prolong lock/unlock` commands are retired and do nothing): write a namespaced checkpoint to `.ws-bridge/agent-checkpoints/` named after your OCP task id (for example GITINSPECT-HARDEN-04-WASM-BACKEND-R2-20261008.json) (status, summary, commit hashes, checks run, artifacts, nextSteps, followUpTasks) and submit the typed phase result for your OCP task through the ws-bridge workflow tools. Say plainly if the work is partial or blocked; never report completion you have not verified. Do not dispatch another continuation unless coordinated.
