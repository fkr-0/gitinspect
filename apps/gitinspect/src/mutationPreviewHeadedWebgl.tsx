import type { GraphDataset } from "@gitinspect/graph-elements";
import { createRoot } from "react-dom/client";

import { GraphViewport } from "./components/GraphViewport";
import { createSyntheticGitHistory } from "./scale/synthetic";
import type { GitMutationPreview } from "./transactions/gitMutationPreview";
import "./styles.css";

interface FrameSample {
  readonly intervals: readonly number[];
  readonly maxGapVisibilityState: DocumentVisibilityState;
  readonly maxGapDocumentHasFocus: boolean;
}

interface HeadedRunEvidence {
  readonly run: number;
  readonly samples: number;
  readonly baselineMedianMs: number;
  readonly baselineP95Ms: number;
  readonly transitionMedianMs: number;
  readonly transitionP95Ms: number;
  readonly transitionMaxMs: number;
  readonly transitionOver16_7Ms: number;
  readonly topologyCommitLatencyMs: number;
  readonly visibilityState: DocumentVisibilityState;
  readonly documentHasFocus: boolean;
  readonly visibilityChanges: number;
  readonly focusEvents: number;
  readonly blurEvents: number;
  readonly maxGapVisibilityState: DocumentVisibilityState;
  readonly maxGapDocumentHasFocus: boolean;
}

interface QualificationResult {
  readonly passed: boolean;
  readonly provenance: "browser-headed-hardware-webgl";
  readonly nativeFpsClaim: false;
  readonly renderer: string;
  readonly logicalCommitCount: number;
  readonly previewCommitCount: number;
  readonly runs: readonly HeadedRunEvidence[];
  readonly accessibilityLive: boolean;
  readonly accessibilityPressed: boolean;
  readonly accessibilityRoving: boolean;
  readonly accessibilityBlocker: string;
  readonly message: string;
}

declare global {
  interface Window {
    __GITINSPECT_PHASE38_HEADED_WEBGL_RESULT__?: QualificationResult;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function sampleAnimationFrames(count: number): Promise<FrameSample> {
  return new Promise((resolve, reject) => {
    const intervals: number[] = [];
    let previous: number | undefined;
    let maxGap = -1;
    let maxGapVisibilityState = document.visibilityState;
    let maxGapDocumentHasFocus = document.hasFocus();
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          `Headed browser requestAnimationFrame cadence stalled after ${intervals.length}/${count} samples`,
        ),
      );
    }, 15_000);
    const tick = (timestamp: number) => {
      if (previous !== undefined) {
        const gap = timestamp - previous;
        intervals.push(gap);
        if (gap > maxGap) {
          maxGap = gap;
          maxGapVisibilityState = document.visibilityState;
          maxGapDocumentHasFocus = document.hasFocus();
        }
      }
      previous = timestamp;
      if (intervals.length >= count) {
        window.clearTimeout(timeout);
        resolve({ intervals, maxGapVisibilityState, maxGapDocumentHasFocus });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function createHeadedGraphFixture(commitCount: number): GraphDataset {
  const synthetic = createSyntheticGitHistory(commitCount);
  const semanticIds = new Map<string, string>();
  for (const node of synthetic.nodes) {
    const oid =
      node.kind === "commit" && typeof node.properties.oid === "string"
        ? node.properties.oid
        : undefined;
    if (oid) semanticIds.set(node.id, `commit:${oid}`);
  }
  return {
    revision: synthetic.revision,
    nodes: synthetic.nodes.map((node) => ({ ...node, id: semanticIds.get(node.id) ?? node.id })),
    edges: synthetic.edges.map((edge) => ({
      ...edge,
      source: semanticIds.get(edge.source) ?? edge.source,
      target: semanticIds.get(edge.target) ?? edge.target,
    })),
  };
}

function previewFixture(
  baseRevision: string,
  logicalCommitCount: number,
  previewCommitCount: number,
): GitMutationPreview {
  assert(
    previewCommitCount > 0 && previewCommitCount < logicalCommitCount,
    "invalid preview fixture bounds",
  );
  const firstRewriteIndex = logicalCommitCount - previewCommitCount;
  const sourceOid = (index: number) => index.toString(16).padStart(40, "0");
  const rewrittenOid = (index: number) => `${"e".repeat(32)}${index.toString(16).padStart(8, "0")}`;
  const rewritten = Array.from({ length: previewCommitCount }, (_, index) => ({
    oldOid: sourceOid(firstRewriteIndex + index),
    newOid: rewrittenOid(index),
    parentOid: index === 0 ? sourceOid(firstRewriteIndex - 1) : rewrittenOid(index - 1),
  }));
  const oldTip = rewritten.at(-1)?.oldOid;
  const newTip = rewritten.at(-1)?.newOid;
  assert(oldTip && newTip, "preview fixture has no rewrite tip");

  return {
    sandboxId: "phase38-headed-browser-sandbox",
    transactionId: "phase38-headed-browser-transition",
    baseRevision,
    operationDigest: `sha256:${"e".repeat(64)}`,
    canonicalOperations: ["rebase-reorder"],
    before: { refs: [], commitCount: logicalCommitCount, truncated: false },
    after: { refs: [], commitCount: logicalCommitCount, truncated: false },
    changedRefs: [{ name: "refs/heads/main", beforeOid: oldTip, afterOid: newTip }],
    rewrittenCommits: rewritten.map((entry) => ({
      oldOid: entry.oldOid,
      newOid: entry.newOid,
      operationIndex: 0,
    })),
    hashCascade: rewritten.map((entry) => ({
      oldOid: entry.oldOid,
      newOid: entry.newOid,
      operationIndex: 0,
      reason: "browser-headed-frame-transition",
      newParentOid: entry.parentOid,
    })),
    droppedCommits: [],
    graphDelta: {
      commits: rewritten.map((entry, index) => ({
        oid: entry.newOid,
        parents: [entry.parentOid],
        message: `Phase 38 headed rewritten commit ${index}`,
        authorName: "Phase 38 Evidence",
        authoredAtMs: 1_700_000_000_000 + index * 60_000,
        committedAtMs: 1_700_000_000_000 + index * 60_000,
      })),
      refs: [{ name: "refs/heads/main", targetOid: newTip, kind: "local-branch" }],
      truncated: false,
    },
    warnings: [],
    failures: [],
    success: true,
    previewToken: "phase38-headed-browser-preview",
  };
}

function hardwareRenderer(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  assert(gl, "GraphScene did not expose a WebGL context");
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  );
  const normalized = renderer.toLocaleLowerCase();
  assert(
    !["llvmpipe", "softpipe", "swiftshader", "software rasterizer"].some((marker) =>
      normalized.includes(marker),
    ),
    `headed browser did not expose hardware WebGL: ${renderer}`,
  );
  return renderer;
}

async function run(): Promise<QualificationResult> {
  const logicalCommitCount = 1_000;
  const previewCommitCount = 32;
  const dataset = createHeadedGraphFixture(logicalCommitCount);
  const preview = previewFixture(dataset.revision, logicalCommitCount, previewCommitCount);
  const selectedRewrite = preview.rewrittenCommits.at(-1);
  assert(selectedRewrite, "preview has no selected rewrite lineage");
  const selectedElementId = `commit:${selectedRewrite.oldOid}`;
  const mount = document.getElementById("mutation-preview-headed-webgl-root");
  assert(mount, "headed browser mount is missing");
  mount.style.position = "fixed";
  mount.style.inset = "0";
  const root = createRoot(mount);
  const render = (mutationPreview: GitMutationPreview | undefined) => {
    root.render(
      <GraphViewport
        dataset={dataset}
        selectedElementId={selectedElementId}
        search=""
        {...(mutationPreview ? { mutationPreview } : {})}
        onSelect={() => undefined}
      />,
    );
  };

  render(undefined);
  await waitFor(
    "GraphScene canvas",
    () => Boolean(mount.querySelector(".viewport__canvas canvas")),
    30_000,
  );
  const canvas = mount.querySelector<HTMLCanvasElement>(".viewport__canvas canvas");
  assert(canvas, "GraphScene canvas disappeared");
  const renderer = hardwareRenderer(canvas);
  window.focus();
  await waitFor(
    "visible focused headed browser",
    () => document.visibilityState === "visible" && document.hasFocus(),
    10_000,
  );

  let visibilityChanges = 0;
  let focusEvents = 0;
  let blurEvents = 0;
  const onVisibility = () => {
    visibilityChanges += 1;
  };
  const onFocus = () => {
    focusEvents += 1;
  };
  const onBlur = () => {
    blurEvents += 1;
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  const runs: HeadedRunEvidence[] = [];
  try {
    for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
      visibilityChanges = 0;
      focusEvents = 0;
      blurEvents = 0;
      render(undefined);
      await waitFor(
        `run ${runIndex} base topology`,
        () =>
          document
            .getElementById("viewport-mutation-status")
            ?.textContent?.includes("No mutation preview active") === true,
      );
      await sampleAnimationFrames(20);
      const baselineEvidence = await sampleAnimationFrames(60);
      const transitionFrames = sampleAnimationFrames(120);
      const transitionRequestedAt = performance.now();
      render(preview);
      await waitFor(
        `run ${runIndex} transformed topology`,
        () =>
          document
            .getElementById("viewport-mutation-status")
            ?.textContent?.includes(
              `${previewCommitCount} authoritative transformed commit nodes`,
            ) === true,
        30_000,
      );
      const topologyCommitLatencyMs = performance.now() - transitionRequestedAt;
      const transitionEvidence = await transitionFrames;
      const baseline = baselineEvidence.intervals;
      const transition = transitionEvidence.intervals;
      const evidence: HeadedRunEvidence = {
        run: runIndex,
        samples: transition.length,
        baselineMedianMs: rounded(percentile(baseline, 0.5)),
        baselineP95Ms: rounded(percentile(baseline, 0.95)),
        transitionMedianMs: rounded(percentile(transition, 0.5)),
        transitionP95Ms: rounded(percentile(transition, 0.95)),
        transitionMaxMs: rounded(Math.max(...transition)),
        transitionOver16_7Ms: transition.filter((value) => value > 16.7).length,
        topologyCommitLatencyMs: rounded(topologyCommitLatencyMs),
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        visibilityChanges,
        focusEvents,
        blurEvents,
        maxGapVisibilityState: transitionEvidence.maxGapVisibilityState,
        maxGapDocumentHasFocus: transitionEvidence.maxGapDocumentHasFocus,
      };
      assert(evidence.samples === 120, `run ${runIndex} sample bound changed`);
      assert(
        evidence.visibilityState === "visible" &&
          evidence.documentHasFocus &&
          evidence.visibilityChanges === 0 &&
          evidence.blurEvents === 0 &&
          evidence.maxGapVisibilityState === "visible" &&
          evidence.maxGapDocumentHasFocus,
        `run ${runIndex} lost headed visibility/focus authority`,
      );
      runs.push(evidence);
    }

    let accessibilityLive = false;
    let accessibilityPressed = false;
    let accessibilityRoving = false;
    let accessibilityBlocker = "";
    const selectedTransformedId = `commit:${selectedRewrite.newOid}`;
    try {
      const liveStatus = document.getElementById("viewport-mutation-status");
      accessibilityLive =
        liveStatus?.getAttribute("aria-live") === "polite" &&
        liveStatus.textContent?.includes(
          `${previewCommitCount} authoritative transformed commit nodes`,
        ) === true;
      assert(accessibilityLive, "headed browser transformed topology live region is not polite");
      await waitFor(
        "projected selected transformed node",
        () =>
          [
            ...document.querySelectorAll<HTMLButtonElement>(
              'button.viewport-node[aria-pressed="true"]',
            ),
          ].some((button) => button.dataset.elementId === selectedTransformedId),
        30_000,
      );
      const projectedButtons = [
        ...document.querySelectorAll<HTMLButtonElement>("button.viewport-node"),
      ];
      const selectedButton = projectedButtons.find(
        (button) =>
          button.getAttribute("aria-pressed") === "true" &&
          button.dataset.elementId === selectedTransformedId,
      );
      accessibilityPressed = selectedButton !== undefined;
      const rovingTabStops = projectedButtons.filter((button) => button.tabIndex === 0);
      accessibilityRoving =
        projectedButtons.length >= 2 &&
        rovingTabStops.length === 1 &&
        rovingTabStops[0] === selectedButton &&
        rovingTabStops[0]?.getAttribute("aria-pressed") === "true";
      assert(
        accessibilityPressed,
        "headed browser transformed selection did not expose aria-pressed",
      );
      assert(
        accessibilityRoving,
        "headed browser transformed selection did not retain one roving tab stop",
      );
    } catch (error: unknown) {
      accessibilityBlocker = error instanceof Error ? error.message : String(error);
    }
    assert(accessibilityBlocker === "", `headed browser accessibility blocker: ${accessibilityBlocker}`);
    assert(accessibilityLive && accessibilityPressed && accessibilityRoving, "headed browser projected-node accessibility is incomplete");

    return {
      passed: true,
      provenance: "browser-headed-hardware-webgl",
      nativeFpsClaim: false,
      renderer,
      logicalCommitCount,
      previewCommitCount,
      runs,
      accessibilityLive,
      accessibilityPressed,
      accessibilityRoving,
      accessibilityBlocker,
      message:
        "Three bounded visible/focused browser-headed hardware-WebGL GraphScene rewrite transitions completed using the production GraphViewport and authoritative preview-delta contracts; this is explicitly not native Tauri FPS evidence.",
    };
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  }
}

async function main() {
  const status = document.getElementById("mutation-preview-headed-webgl-status");
  try {
    const result = await run();
    window.__GITINSPECT_PHASE38_HEADED_WEBGL_RESULT__ = result;
    if (status) status.textContent = `PASS\n${JSON.stringify(result, null, 2)}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const result: QualificationResult = {
      passed: false,
      provenance: "browser-headed-hardware-webgl",
      nativeFpsClaim: false,
      renderer: "unavailable",
      logicalCommitCount: 1_000,
      previewCommitCount: 32,
      runs: [],
      accessibilityLive: false,
      accessibilityPressed: false,
      accessibilityRoving: false,
      accessibilityBlocker: "qualification failed before headed accessibility probing",
      message,
    };
    window.__GITINSPECT_PHASE38_HEADED_WEBGL_RESULT__ = result;
    if (status) status.textContent = `FAIL\n${JSON.stringify(result, null, 2)}`;
  }
}

void main();
