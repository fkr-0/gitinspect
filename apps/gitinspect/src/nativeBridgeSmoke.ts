import type { GraphDataset, WorldNavigationFrame } from "@gitinspect/graph-elements";
import { WorldNavigationStack } from "@gitinspect/graph-elements";

import { reconcileNavigationAfterRepositoryRefresh } from "./App";
import { gitGraphIds, repositorySnapshotToGraphDataset } from "./domain/graphAdapter";
import { GitCommitDrilldownResolver } from "./drilldown/gitCommitDrilldown";
import type { RepositorySession } from "./services/repository";
import { RepositoryLiveRefreshCoordinator } from "./services/repositoryLiveRefresh";
import { createTauriRepositoryService } from "./services/tauriRepository";
import { initialStudioState, type StudioState, studioReducer } from "./state/studio";

interface SmokeMutationResult {
  readonly phase: string;
  readonly oids: readonly string[];
}

interface SmokeReport {
  readonly passed: boolean;
  readonly message: string;
  readonly serviceMode: string;
  readonly globalTauri: boolean;
  readonly changeCount: number;
  readonly refreshCount: number;
  readonly initialRevision: string;
  readonly rapidRevision: string;
  readonly finalRevision: string;
  readonly rapidCommitOids: readonly string[];
  readonly deepSelectionId: string;
  readonly deepSelectionPreserved: boolean;
  readonly disappearedElementId: string;
  readonly selectionCleared: boolean;
  readonly selectionNotice: string;
  readonly navigationRewound: boolean;
  readonly navigationNotice: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rootFrame(
  session: RepositorySession,
  dataset: GraphDataset,
  selectionId?: string,
): WorldNavigationFrame {
  return {
    datasetIdentity: `${session.key}:${session.snapshot.revision}:repository`,
    dataset,
    mapperKey: "git-repository-v1",
    layoutKey: "git-repository-lod-v1",
    ...(selectionId === undefined ? {} : { selectionId }),
    camera: {
      mode: "attached",
      position: [10, 6, 16],
      target: [0, 0, 0],
      ...(selectionId === undefined ? {} : { attachedNodeId: selectionId }),
      zoom: 1,
    },
  };
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function status(message: string): void {
  const node = document.getElementById("native-bridge-smoke-status");
  if (node) node.textContent = message;
}

async function run(): Promise<void> {
  const tauri = window.__TAURI__;
  assert(tauri?.core?.invoke, "window.__TAURI__.core.invoke is unavailable in the native webview");
  assert(tauri.event?.listen, "window.__TAURI__.event.listen is unavailable in the native webview");

  const repositoryPath = new URL(window.location.href).searchParams.get("repository");
  assert(repositoryPath, "native bridge smoke repository path is missing");

  const service = createTauriRepositoryService();
  assert(service?.mode === "native", "createTauriRepositoryService did not bind the native global");

  let session = await service.openRepository(repositoryPath);
  const initialRevision = session.snapshot.revision;
  let dataset = repositorySnapshotToGraphDataset(session.snapshot);
  let studio: StudioState = studioReducer(
    { ...initialStudioState, repositoryPath },
    { type: "repositoryLoaded", session, dataset },
  );

  const selectedOid = session.snapshot.head;
  assert(selectedOid, "fixture opened without a HEAD commit");
  const selectedCommitId = gitGraphIds.commit(selectedOid);
  assert(
    dataset.nodes.some((node) => node.id === selectedCommitId),
    "fixture HEAD commit is absent from the authoritative logical dataset",
  );
  studio = studioReducer(studio, { type: "elementSelected", elementId: selectedCommitId });

  const resolver = new GitCommitDrilldownResolver(service, () => session);
  let navigation = new WorldNavigationStack(
    rootFrame(session, dataset, selectedCommitId),
    resolver.resolve,
  );
  assert(await navigation.enter(selectedCommitId), "selected commit drill-down did not resolve");
  const changedFile = navigation.current.dataset.nodes.find(
    (node) => node.kind.startsWith("changed-file-") && node.properties.path === "survive.txt",
  );
  assert(
    changedFile,
    "selected fixture commit did not expose survive.txt through lazy commit diff",
  );
  navigation.replace({ ...navigation.current, selectionId: changedFile.id });
  assert(
    await navigation.enter(changedFile.id),
    "selected changed-file drill-down did not resolve",
  );
  const hunk = navigation.current.dataset.nodes.find((node) => node.kind === "diff-hunk");
  assert(hunk, "selected changed-file detail did not expose a bounded hunk node");
  navigation.replace({ ...navigation.current, selectionId: hunk.id });
  const deepBeforeRapid = navigation.snapshot();
  const deepSelectionId = hunk.id;

  let changeCount = 0;
  let refreshCount = 0;
  let refreshError: unknown;
  const coordinator = new RepositoryLiveRefreshCoordinator(service, session, {
    onRefreshed: (refreshed) => {
      session = refreshed;
      dataset = repositorySnapshotToGraphDataset(refreshed.snapshot);
      studio = studioReducer(studio, { type: "repositoryLoaded", session: refreshed, dataset });
      refreshCount += 1;
    },
    onError: (error) => {
      refreshError = error;
    },
  });

  const stopWatch = await service.watchRepository(session, (change) => {
    changeCount += 1;
    coordinator.request(change);
  });

  status("native event listener active; applying rapid fixture commits…");
  const rapid = await tauri.core.invoke<SmokeMutationResult>("native_bridge_smoke_mutate", {
    phase: "rapid",
  });
  assert(rapid.oids.length === 2, `rapid phase returned ${rapid.oids.length} commits instead of 2`);
  await waitFor("both rapid commits to cross native events and compact/delta refresh", () => {
    if (refreshError) throw refreshError;
    return rapid.oids.every((oid) => session.snapshot.commits.some((commit) => commit.oid === oid));
  });
  assert(changeCount > 0, "rapid repository changes produced no repository://changed callback");
  assert(refreshCount > 0, "rapid repository changes produced no coordinator refresh");
  const rapidRevision = session.snapshot.revision;
  assert(
    rapidRevision !== initialRevision,
    "rapid native refresh did not advance repository revision",
  );
  assert(
    studio.selectedElementId === selectedCommitId,
    "Studio lost a surviving logical commit selection",
  );

  resolver.clear();
  const restored = await reconcileNavigationAfterRepositoryRefresh(
    deepBeforeRapid,
    rootFrame(session, dataset, studio.selectedElementId),
    resolver.resolve,
    studio.selectedElementId,
  );
  const deepSelectionPreserved =
    restored.stack.depth === 2 &&
    restored.snapshot.current.selectionId === deepSelectionId &&
    restored.message === undefined;
  assert(deepSelectionPreserved, restored.message ?? "deep navigation selection was not restored");
  navigation = restored.stack;

  status("surviving deep selection restored; removing its logical commit from fixture history…");
  const deepBeforeDisappear = navigation.snapshot();
  await tauri.core.invoke<SmokeMutationResult>("native_bridge_smoke_mutate", {
    phase: "disappear",
  });
  await waitFor("selected logical commit to disappear through native refresh", () => {
    if (refreshError) throw refreshError;
    return (
      !dataset.nodes.some((node) => node.id === selectedCommitId) &&
      studio.selectedElementId === undefined &&
      studio.selectionNotice?.includes(selectedCommitId) === true
    );
  });
  const selectionNotice = studio.selectionNotice ?? "";
  const selectionCleared = studio.selectedElementId === undefined;
  assert(
    selectionCleared,
    "Studio retained a logical object that disappeared from refreshed history",
  );
  assert(
    selectionNotice.includes("no longer present after repository refresh"),
    `Studio disappearance notice was not explicit: ${selectionNotice}`,
  );

  resolver.clear();
  const rewound = await reconcileNavigationAfterRepositoryRefresh(
    deepBeforeDisappear,
    rootFrame(session, dataset),
    resolver.resolve,
    studio.selectedElementId,
  );
  const navigationRewound = rewound.stack.depth === 0;
  const navigationNotice = rewound.message ?? "";
  assert(
    navigationRewound,
    "derived commit/file navigation did not rewind after root disappearance",
  );
  assert(
    navigationNotice.includes(selectedCommitId),
    `navigation rewind notice did not identify the disappeared logical commit: ${navigationNotice}`,
  );

  coordinator.dispose();
  await stopWatch();

  const report: SmokeReport = {
    passed: true,
    message:
      "actual Tauri global invoke/listen -> native watcher -> coordinator -> Studio provenance passed",
    serviceMode: service.mode,
    globalTauri: true,
    changeCount,
    refreshCount,
    initialRevision,
    rapidRevision,
    finalRevision: session.snapshot.revision,
    rapidCommitOids: rapid.oids,
    deepSelectionId,
    deepSelectionPreserved,
    disappearedElementId: selectedCommitId,
    selectionCleared,
    selectionNotice,
    navigationRewound,
    navigationNotice,
  };
  status(`PASS\n${JSON.stringify(report, null, 2)}`);
  await tauri.core.invoke<void>("native_bridge_smoke_complete", { report });
}

void run().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  status(`FAIL\n${message}`);
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) throw error;
  const report: SmokeReport = {
    passed: false,
    message,
    serviceMode: "unknown",
    globalTauri: true,
    changeCount: 0,
    refreshCount: 0,
    initialRevision: "",
    rapidRevision: "",
    finalRevision: "",
    rapidCommitOids: [],
    deepSelectionId: "",
    deepSelectionPreserved: false,
    disappearedElementId: "",
    selectionCleared: false,
    selectionNotice: "",
    navigationRewound: false,
    navigationNotice: "",
  };
  await tauri.core.invoke<void>("native_bridge_smoke_complete", { report });
});
