import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createTauriRepositoryService } from "./services/tauriRepository";
import "./styles.css";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface StageReport {
  readonly stage: string;
  readonly route: string;
  readonly selectedSemanticId: string | null;
  readonly runtimeMode: string;
  readonly repositoryPath: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
  };
  readonly graphViewport: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly labelCount: number;
  readonly overlapPairs: number;
  readonly occupancyPercent: {
    readonly horizontal: number;
    readonly vertical: number;
  };
  readonly labelClearancePx: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly chronologySpanPx?: number;
  readonly chronologySpanPercentGraphWidth?: number;
  readonly branchPeelPx?: number;
  readonly branchPeelPercentGraphHeight?: number;
  readonly featureToMerge?: {
    readonly dxPx: number;
    readonly dyPx: number;
  };
  readonly attachmentDistancesPx?: Readonly<Record<string, number>>;
  readonly maxDirectAttachmentPercentGraphDiagonal?: number;
}

interface FinalReport {
  readonly passed: boolean;
  readonly message: string;
  readonly repositoryPath: string;
  readonly serviceMode: string;
  readonly globalTauri: boolean;
  readonly stages: readonly StageReport[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor<T>(
  description: string,
  read: () => T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function setTextInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert(setter, "HTMLInputElement.value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function visibleViewportLabels(): readonly HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".viewport-node")].filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

function projectedPoint(element: HTMLElement, graph: DOMRect): Point | undefined {
  const x = Number.parseFloat(element.style.getPropertyValue("--point-x"));
  const y = Number.parseFloat(element.style.getPropertyValue("--point-y"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: graph.left + (x / 100) * graph.width,
    y: graph.top + (y / 100) * graph.height,
  };
}

function overlapPairCount(rectangles: readonly DOMRect[]): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      const left = rectangles[leftIndex];
      const right = rectangles[rightIndex];
      if (!left || !right) continue;
      const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      if (overlapX > 0 && overlapY > 0) count += 1;
    }
  }
  return count;
}

function euclideanDistance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function stageReport(stage: string): StageReport {
  const graphElement = document.querySelector<HTMLElement>('[data-testid="graph-viewport"]');
  assert(graphElement, "Graph viewport is unavailable");
  const graph = graphElement.getBoundingClientRect();
  const labels = visibleViewportLabels();
  assert(labels.length > 0, "Native viewport exposed no projected labels");
  const points = labels
    .map((element) => projectedPoint(element, graph))
    .filter((point): point is Point => point !== undefined);
  assert(points.length > 0, "Native viewport exposed no projected label points");

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const rectangles = labels.map((element) => element.getBoundingClientRect());
  const minLabelLeft = Math.min(...rectangles.map((rect) => rect.left));
  const maxLabelRight = Math.max(...rectangles.map((rect) => rect.right));
  const minLabelTop = Math.min(...rectangles.map((rect) => rect.top));
  const maxLabelBottom = Math.max(...rectangles.map((rect) => rect.bottom));

  const pointByTitle = new Map<string, Point>();
  for (const label of labels) {
    const point = projectedPoint(label, graph);
    if (point) pointByTitle.set(label.title, point);
  }
  const point = (title: string): Point | undefined => pointByTitle.get(title);
  const oldest = point("Initialize visualization workspace");
  const newest = point("Integrate repository world shell");
  const mainBranchCommit = point("Add deterministic layered layout");
  const featureCommit = point("Prototype attached camera mode");
  const merge = point("Merge camera traversal prototype");
  const head = point("HEAD");
  const mainRef = point("main");
  const featureRef = point("camera-lab");
  const remoteRef = point("origin/main");
  const tag = point("v0.1.0-alpha");
  const tagTarget = point("Define graph element contracts");
  const remote = point("origin");

  const attachmentDistances: Record<string, number> = {};
  if (head && mainRef) attachmentDistances.headToMain = euclideanDistance(head, mainRef);
  if (mainRef && newest) attachmentDistances.mainToCurrentTip = euclideanDistance(mainRef, newest);
  if (featureRef && featureCommit)
    attachmentDistances.cameraLabToFeature = euclideanDistance(featureRef, featureCommit);
  if (remoteRef && merge) attachmentDistances.originMainToMerge = euclideanDistance(remoteRef, merge);
  if (tag && tagTarget) attachmentDistances.tagToTaggedCommit = euclideanDistance(tag, tagTarget);
  if (remote && remoteRef)
    attachmentDistances.originPlatformToOriginMain = euclideanDistance(remote, remoteRef);

  const chronologySpanPx = oldest && newest ? Math.abs(newest.x - oldest.x) : undefined;
  const branchPeelPx =
    mainBranchCommit && featureCommit ? Math.abs(featureCommit.y - mainBranchCommit.y) : undefined;
  const graphDiagonal = Math.hypot(graph.width, graph.height);
  const maximumAttachment = Math.max(0, ...Object.values(attachmentDistances));
  const selectedSemanticId = new URL(window.location.href).searchParams.get("selection");
  const runtimeMode =
    document.querySelector<HTMLElement>(".runtime-badge")?.textContent?.trim() ?? "unknown";
  const repositoryPath =
    document.querySelector<HTMLInputElement>("#repository-path")?.value ?? "unknown";

  return {
    stage,
    route: `${window.location.pathname}${window.location.search}`,
    selectedSemanticId,
    runtimeMode,
    repositoryPath,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    graphViewport: {
      x: graph.left,
      y: graph.top,
      width: graph.width,
      height: graph.height,
    },
    labelCount: labels.length,
    overlapPairs: overlapPairCount(rectangles),
    occupancyPercent: {
      horizontal: ((maxX - minX) / graph.width) * 100,
      vertical: ((maxY - minY) / graph.height) * 100,
    },
    labelClearancePx: {
      left: minLabelLeft - graph.left,
      right: graph.right - maxLabelRight,
      top: minLabelTop - graph.top,
      bottom: graph.bottom - maxLabelBottom,
    },
    ...(chronologySpanPx === undefined
      ? {}
      : {
          chronologySpanPx,
          chronologySpanPercentGraphWidth: (chronologySpanPx / graph.width) * 100,
        }),
    ...(branchPeelPx === undefined
      ? {}
      : {
          branchPeelPx,
          branchPeelPercentGraphHeight: (branchPeelPx / graph.height) * 100,
        }),
    ...(featureCommit && merge
      ? {
          featureToMerge: {
            dxPx: merge.x - featureCommit.x,
            dyPx: merge.y - featureCommit.y,
          },
        }
      : {}),
    ...(Object.keys(attachmentDistances).length === 0
      ? {}
      : {
          attachmentDistancesPx: attachmentDistances,
          maxDirectAttachmentPercentGraphDiagonal: (maximumAttachment / graphDiagonal) * 100,
        }),
  };
}

async function waitForStableProjection(): Promise<void> {
  let previous = "";
  let stableSamples = 0;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const sample = visibleViewportLabels()
      .map((element) => [
        element.title,
        element.style.getPropertyValue("--point-x"),
        element.style.getPropertyValue("--point-y"),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right)));
    const serialized = JSON.stringify(sample);
    if (serialized.length > 2 && serialized === previous) stableSamples += 1;
    else stableSamples = 0;
    if (stableSamples >= 3) return;
    previous = serialized;
    await sleep(120);
  }
  throw new Error("Native viewport projection did not stabilize");
}

async function selectRepositoryRow(label: string): Promise<void> {
  const button = await waitFor(`repository row ${label}`, () =>
    [...document.querySelectorAll<HTMLButtonElement>(".object-list__row")].find(
      (candidate) => candidate.querySelector("strong")?.textContent?.trim() === label,
    ),
  );
  button.click();
  await waitFor(`selected repository row ${label}`, () =>
    button.getAttribute("aria-pressed") === "true" ? true : undefined,
  );
  await waitForStableProjection();
}

async function emitStage(report: StageReport): Promise<void> {
  const tauri = window.__TAURI__;
  assert(tauri?.core?.invoke, "window.__TAURI__.core.invoke is unavailable");
  await tauri.core.invoke<void>("native_visual_stage", {
    stage: report.stage,
    reportJson: JSON.stringify(report, null, 2),
  });
  // Keep the exact rendered state visible long enough for the external X11 evidence capture.
  await sleep(5_000);
}

async function run(): Promise<void> {
  const root = document.getElementById("root");
  assert(root, "gitinspect root element is missing");
  const tauri = window.__TAURI__;
  assert(tauri?.core?.invoke, "window.__TAURI__.core.invoke is unavailable in the native webview");
  assert(tauri.event?.listen, "window.__TAURI__.event.listen is unavailable in the native webview");
  const repositoryPath = new URL(window.location.href).searchParams.get("repository");
  assert(repositoryPath, "native visual smoke repository path is missing");
  const service = createTauriRepositoryService();
  assert(service?.mode === "native", "native visual smoke did not bind the production native service");

  createRoot(root).render(
    <StrictMode>
      <App repositoryService={service} autoOpenDemo={false} />
    </StrictMode>,
  );

  const pathInput = await waitFor("repository path input", () =>
    document.querySelector<HTMLInputElement>("#repository-path") ?? undefined,
  );
  setTextInputValue(pathInput, repositoryPath);
  await waitFor("controlled repository path update", () =>
    pathInput.value === repositoryPath ? true : undefined,
  );
  const form = pathInput.closest("form");
  assert(form instanceof HTMLFormElement, "repository form is unavailable");
  form.requestSubmit();

  await waitFor("native repository ready state", () =>
    document.querySelector('footer.statusbar i[data-state="ready"]') ? true : undefined,
  );
  await waitFor("native adapter badge", () => {
    const badge = document.querySelector<HTMLElement>('.runtime-badge[data-mode="native"]');
    return badge?.textContent?.includes("native adapter") ? true : undefined;
  });
  await waitFor("native projected repository labels", () =>
    visibleViewportLabels().length >= 10 ? true : undefined,
  );
  await waitForStableProjection();

  const reports: StageReport[] = [];
  const overview = stageReport("overview");
  reports.push(overview);
  await emitStage(overview);

  await selectRepositoryRow("Integrate repository world shell");
  const currentLine = stageReport("current-line");
  reports.push(currentLine);
  await emitStage(currentLine);

  await selectRepositoryRow("Merge camera traversal prototype");
  const merge = stageReport("merge");
  reports.push(merge);
  await emitStage(merge);

  const finalReport: FinalReport = {
    passed: true,
    message:
      "production App in real Tauri WebKit -> native repository service -> Railfield visual states passed",
    repositoryPath,
    serviceMode: service.mode,
    globalTauri: true,
    stages: reports,
  };
  await tauri.core.invoke<void>("native_visual_complete", {
    passed: true,
    reportJson: JSON.stringify(finalReport, null, 2),
  });
}

void run().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) throw error;
  const repositoryPath = new URL(window.location.href).searchParams.get("repository") ?? "";
  const report: FinalReport = {
    passed: false,
    message,
    repositoryPath,
    serviceMode: "unknown",
    globalTauri: true,
    stages: [],
  };
  await tauri.core.invoke<void>("native_visual_complete", {
    passed: false,
    reportJson: JSON.stringify(report, null, 2),
  });
});
