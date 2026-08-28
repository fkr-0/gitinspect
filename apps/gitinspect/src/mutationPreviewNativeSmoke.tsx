import { createRoot, type Root } from "react-dom/client";
import type { RepositorySession } from "./services/repository";
import { createTauriRepositoryService } from "./services/tauriRepository";
import { GitMutationPreviewTray } from "./transactions/GitMutationPreviewTray";

interface FixtureMetadata {
  readonly baseOid: string;
  readonly mainOid: string;
  readonly linearOids: readonly string[];
  readonly conflictOid: string;
  readonly longOids: readonly string[];
}

interface SandboxProbe {
  readonly sandboxCount: number;
  readonly longPreviewStarted: boolean;
}

interface RewriteEvidence {
  readonly oldOids: readonly string[];
  readonly newOids: readonly string[];
  readonly parentOids: readonly string[];
}

interface SmokeReport {
  readonly passed: boolean;
  readonly message: string;
  readonly rewriteKinds: readonly string[];
  readonly orderedOperationSummaries: readonly string[];
  readonly reorderOldOids: readonly string[];
  readonly reorderNewOids: readonly string[];
  readonly cascadeParentOids: readonly string[];
  readonly conflictFiles: readonly string[];
  readonly staleMessage: string;
  readonly cancellationPreviewStarted: boolean;
  readonly cancellationReturnedToIdle: boolean;
  readonly confirmSandboxCount: number;
  readonly conflictSandboxCount: number;
  readonly cancellationSandboxCount: number;
  readonly applyDisabled: boolean;
  readonly eagerMaterializationCommandsRegistered: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function status(message: string): void {
  const node = document.getElementById("mutation-preview-native-smoke-status");
  if (node) node.textContent = message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function text(node: Element | null): string {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => text(button) === label,
  );
}

async function clickButton(label: string): Promise<void> {
  const button = buttonByText(label);
  assert(button, `Button ${JSON.stringify(label)} is unavailable`);
  assert(!button.disabled, `Button ${JSON.stringify(label)} is disabled`);
  button.click();
  await sleep(0);
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  assert(setter, `No native value setter exists for ${element.tagName}`);
  setter.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
  if (!(element instanceof HTMLSelectElement)) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function chooseKind(kind: string): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Preview operation"]',
  );
  assert(select, "Preview operation select is unavailable");
  setNativeValue(select, kind);
  await waitFor(`operation kind ${kind}`, () => select.value === kind);
  await sleep(0);
}

async function fill(label: string, value: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[aria-label="${label}"], textarea[aria-label="${label}"]`,
  );
  assert(field, `Field ${JSON.stringify(label)} is unavailable`);
  setNativeValue(field, value);
  await waitFor(`field ${label}`, () => field.value === value);
  await sleep(0);
}

async function stageBranchCreate(name: string): Promise<void> {
  await chooseKind("branch-create");
  await fill("Branch name", name);
  await waitFor(
    "branch-create draft validation",
    () => buttonByText("Stage operation")?.disabled === false,
  );
  await clickButton("Stage operation");
}

async function stageRewrite(
  kind: "rebase-reorder" | "squash" | "fixup",
  branch: string,
  ontoOid: string,
  commitOids: readonly string[],
): Promise<void> {
  await chooseKind(kind);
  await fill("Branch name", branch);
  await fill("Onto object ID", ontoOid);
  const label =
    kind === "rebase-reorder"
      ? "Commit object IDs in desired order"
      : "Commit object IDs in branch order";
  await fill(label, commitOids.join("\n"));
  await waitFor(
    `${kind} draft validation`,
    () => buttonByText("Stage operation")?.disabled === false,
  );
  await clickButton("Stage operation");
}

async function stageCherryPick(commitOid: string): Promise<void> {
  await chooseKind("cherry-pick");
  await fill("Commit object ID", commitOid);
  await waitFor(
    "cherry-pick draft validation",
    () => buttonByText("Stage operation")?.disabled === false,
  );
  await clickButton("Stage operation");
}

function stagedSummaries(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      'ol[aria-label="Staged preview operations"] > li > span',
    ),
  ].map((node) => text(node));
}

async function removeAllStaged(): Promise<void> {
  while (true) {
    const before = stagedSummaries().length;
    if (before === 0) return;
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove operation 1"]',
    );
    assert(remove && !remove.disabled, "First staged operation cannot be removed");
    remove.click();
    await waitFor("staged operation removal", () => stagedSummaries().length === before - 1);
  }
}

async function clearPreview(): Promise<void> {
  const clear = buttonByText("Clear preview");
  if (!clear) return;
  assert(!clear.disabled, "Clear preview control is disabled");
  clear.click();
  await waitFor(
    "preview result to clear",
    () => document.querySelector('[data-testid="mutation-preview-result"]') === null,
  );
}

async function resetTray(): Promise<void> {
  await clearPreview();
  await removeAllStaged();
  await waitFor("empty staged tray", () => text(document.body).includes("No operations staged."));
}

async function previewAndWait(expectedHeading: "Preview succeeded" | "Preview has conflicts") {
  await clickButton("Preview ordered operations");
  await waitFor(
    expectedHeading,
    () => {
      const result = document.querySelector('[data-testid="mutation-preview-result"]');
      return text(result).includes(expectedHeading);
    },
    20_000,
  );
  const result = document.querySelector<HTMLElement>('[data-testid="mutation-preview-result"]');
  assert(result, "Preview result disappeared after completion");
  return result;
}

function parseRewriteEvidence(
  result: HTMLElement,
  operationNumber: number,
  reason: string,
): RewriteEvidence {
  const paragraphs = [...result.querySelectorAll("p")].map((node) => text(node));
  const rewritePattern = new RegExp(
    `^Rewrite operation ${operationNumber}: ([0-9a-f]{40}) → ([0-9a-f]{40})$`,
  );
  const cascadePattern = new RegExp(
    `^Hash cascade operation ${operationNumber} · ${reason}: ([0-9a-f]{40}) → ([0-9a-f]{40}) · parent ([0-9a-f]{40})$`,
  );
  const rewrites = paragraphs
    .map((line) => rewritePattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  const cascades = paragraphs
    .map((line) => cascadePattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  assert(rewrites.length > 0, `No rewritten-commit evidence rendered for ${reason}`);
  assert(
    rewrites.length === cascades.length,
    `${reason} rewrite/hash-cascade evidence counts differ (${rewrites.length} vs ${cascades.length})`,
  );
  for (let index = 0; index < rewrites.length; index += 1) {
    assert(
      rewrites[index]?.[1] === cascades[index]?.[1] &&
        rewrites[index]?.[2] === cascades[index]?.[2],
      `${reason} hash-cascade evidence diverged at entry ${index + 1}`,
    );
  }
  return {
    oldOids: rewrites.map((match) => match[1] ?? ""),
    newOids: rewrites.map((match) => match[2] ?? ""),
    parentOids: cascades.map((match) => match[3] ?? ""),
  };
}

async function probe(): Promise<SandboxProbe> {
  const tauri = window.__TAURI__;
  assert(tauri?.core?.invoke, "Tauri invoke is unavailable");
  return tauri.core.invoke<SandboxProbe>("mutation_preview_native_smoke_probe");
}

async function waitForSandboxCount(expected: number, timeoutMs = 10_000): Promise<SandboxProbe> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (Date.now() < deadline) {
    last = await probe();
    if (last.sandboxCount === expected) return last;
    await sleep(20);
  }
  throw new Error(
    `Timed out waiting for ${expected} sandbox(es); last observed ${last.sandboxCount}`,
  );
}

function renderTray(
  root: Root,
  session: RepositorySession,
  selectedCommitOid: string | undefined,
): void {
  root.render(
    <GitMutationPreviewTray
      open
      session={session}
      {...(selectedCommitOid === undefined ? {} : { selectedCommitOid })}
    />,
  );
}

async function run(): Promise<void> {
  const tauri = window.__TAURI__;
  assert(tauri?.core?.invoke, "window.__TAURI__.core.invoke is unavailable in the native webview");

  const repositoryPath = new URL(window.location.href).searchParams.get("repository");
  assert(repositoryPath, "native mutation-preview smoke repository path is missing");
  const service = createTauriRepositoryService();
  assert(service?.mode === "native", "native repository service did not bind the Tauri global");
  let session = await service.openRepository(repositoryPath);
  const fixture = await tauri.core.invoke<FixtureMetadata>("mutation_preview_native_smoke_fixture");
  assert(
    fixture.linearOids.length === 3,
    "fixture must expose exactly three linear rewrite commits",
  );
  assert(fixture.longOids.length === 64, "fixture must expose the 64-commit cancellation range");
  const [linearFirst, linearSecond, linearThird] = fixture.linearOids;
  assert(linearFirst && linearSecond && linearThird, "fixture linear rewrite OIDs are incomplete");
  assert(
    session.snapshot.head === fixture.mainOid,
    "opened fixture HEAD does not match native metadata",
  );

  const mount = document.getElementById("mutation-preview-native-smoke-root");
  assert(mount, "native mutation-preview smoke mount is missing");
  const root = createRoot(mount);
  let selectedCommitOid: string | undefined = fixture.mainOid;
  renderTray(root, session, selectedCommitOid);
  await waitFor("actual mutation preview tray mount", () =>
    Boolean(document.querySelector('[data-testid="mutation-preview-tray"]')),
  );

  const rewriteKinds: string[] = [];
  status("testing ordered native rebase-reorder preview and preview-only confirmation…");
  await stageBranchCreate("preview-created-first");
  const reorderRequested = [linearThird, linearFirst, linearSecond];
  await stageRewrite("rebase-reorder", "linear", fixture.baseOid, reorderRequested);
  await waitFor("two ordered staged operations", () => stagedSummaries().length === 2);
  const orderedOperationSummaries = stagedSummaries();
  assert(
    orderedOperationSummaries[0]?.startsWith("1. Create branch preview-created-first"),
    `first staged operation changed order: ${orderedOperationSummaries[0]}`,
  );
  assert(
    orderedOperationSummaries[1]?.includes(`2. Reorder ${reorderRequested.join(" → ")}`),
    `second staged rewrite/commit ordering changed: ${orderedOperationSummaries[1]}`,
  );
  const reorderResult = await previewAndWait("Preview succeeded");
  assert(
    text(reorderResult).includes("2 ordered operation(s) evaluated."),
    "backend did not evaluate both operations",
  );
  assert(
    text(reorderResult).includes("refs/heads/preview-created-first"),
    "first operation ref evidence is missing",
  );
  assert(
    text(reorderResult).includes("refs/heads/linear"),
    "reordered branch ref evidence is missing",
  );
  const reorderEvidence = parseRewriteEvidence(reorderResult, 2, "rebase-reorder");
  assert(
    JSON.stringify(reorderEvidence.oldOids) === JSON.stringify(reorderRequested),
    `rebase-reorder rewrite evidence changed caller commit order: ${reorderEvidence.oldOids.join(",")}`,
  );
  assert(
    reorderEvidence.parentOids[0] === fixture.baseOid,
    "first hash-cascade parent is not onto OID",
  );
  assert(
    reorderEvidence.parentOids[1] === reorderEvidence.newOids[0],
    "second cascade parent is not first rewrite",
  );
  assert(
    reorderEvidence.parentOids[2] === reorderEvidence.newOids[1],
    "third cascade parent is not second rewrite",
  );
  rewriteKinds.push("rebase-reorder");

  await clickButton("Confirm preview only");
  await waitFor("preview-only confirmation", () =>
    text(document.body).includes(
      "Disposable preview confirmed. Its sandbox has been destroyed; apply remains unavailable.",
    ),
  );
  const confirmSandboxCount = (await waitForSandboxCount(0)).sandboxCount;
  const apply = buttonByText("Apply to repository");
  const applyDisabled = apply?.disabled === true;
  assert(applyDisabled, "Apply to repository unexpectedly became enabled");
  await resetTray();

  status("testing native squash rewrite evidence…");
  await stageRewrite("squash", "linear", fixture.baseOid, fixture.linearOids);
  const squashResult = await previewAndWait("Preview succeeded");
  const squashEvidence = parseRewriteEvidence(squashResult, 1, "squash");
  assert(
    JSON.stringify(squashEvidence.oldOids) === JSON.stringify(fixture.linearOids),
    "squash evidence did not preserve original branch order",
  );
  assert(
    new Set(squashEvidence.newOids).size === 1,
    "squash did not map the full range to one rewritten commit",
  );
  rewriteKinds.push("squash");
  await resetTray();
  await waitForSandboxCount(0);

  status("testing native fixup rewrite evidence…");
  await stageRewrite("fixup", "linear", fixture.baseOid, fixture.linearOids);
  const fixupResult = await previewAndWait("Preview succeeded");
  const fixupEvidence = parseRewriteEvidence(fixupResult, 1, "fixup");
  assert(
    JSON.stringify(fixupEvidence.oldOids) === JSON.stringify(fixture.linearOids),
    "fixup evidence did not preserve original branch order",
  );
  assert(
    new Set(fixupEvidence.newOids).size === 1,
    "fixup did not map the full range to one rewritten commit",
  );
  rewriteKinds.push("fixup");
  await resetTray();
  await waitForSandboxCount(0);

  status("testing structured native cherry-pick conflict rendering…");
  await stageCherryPick(fixture.conflictOid);
  const conflictResult = await previewAndWait("Preview has conflicts");
  const conflictLine = [...conflictResult.querySelectorAll("p")]
    .map((node) => text(node))
    .find((line) => line.startsWith("Conflicts: "));
  assert(
    conflictLine === "Conflicts: conflict.txt",
    `unexpected conflict presentation: ${conflictLine}`,
  );
  const conflictFiles = conflictLine.slice("Conflicts: ".length).split(", ");
  rewriteKinds.push("cherry-pick");
  const conflictSandboxCount = (await waitForSandboxCount(0)).sandboxCount;
  await resetTray();

  status("testing stale native revision rejection through real repository authority…");
  const staleSession = session;
  await stageCherryPick(linearFirst);
  await tauri.core.invoke<string>("mutation_preview_native_smoke_advance");
  const refreshedSession = await service.refreshRepository(session);
  assert(
    refreshedSession.snapshot.revision !== staleSession.snapshot.revision,
    "intentional fixture advance did not change repository revision",
  );
  await clickButton("Preview ordered operations");
  await waitFor("stale revision alert", () =>
    text(document.querySelector('[role="alert"]')).includes("stale repository revision"),
  );
  const staleMessage = text(document.querySelector('[role="alert"]'));
  assert(
    staleMessage.includes(staleSession.snapshot.revision),
    "stale rejection omitted expected revision",
  );
  assert(
    staleMessage.includes(refreshedSession.snapshot.revision),
    "stale rejection omitted current revision",
  );
  await removeAllStaged();
  session = refreshedSession;
  selectedCommitOid = session.snapshot.head;
  renderTray(root, session, selectedCommitOid);
  await waitFor("tray to bind refreshed native revision", () =>
    text(document.body).includes(`base: ${session.snapshot.revision}`),
  );

  status("testing cancellation after native 64-commit rewrite execution has entered the sandbox…");
  const longRequested = [...fixture.longOids].reverse();
  await stageRewrite("rebase-reorder", "long", fixture.baseOid, longRequested);
  await clickButton("Preview ordered operations");
  await waitFor("loading UI", () => buttonByText("Previewing…") !== undefined);

  const previewDeadline = Date.now() + 20_000;
  let cancellationPreviewStarted = false;
  while (Date.now() < previewDeadline) {
    const currentProbe = await probe();
    if (currentProbe.longPreviewStarted && buttonByText("Previewing…") !== undefined) {
      cancellationPreviewStarted = true;
      break;
    }
    if (document.querySelector('[data-testid="mutation-preview-result"]')) {
      throw new Error(
        "64-commit native preview completed before in-flight cancellation could be exercised",
      );
    }
    await sleep(10);
  }
  assert(
    cancellationPreviewStarted,
    "native rewrite never exposed an in-flight long-branch sandbox",
  );

  selectedCommitOid = fixture.baseOid;
  renderTray(root, session, selectedCommitOid);
  await waitFor(
    "context-change cancellation to return tray to idle",
    () => buttonByText("Preview ordered operations")?.disabled === false,
  );
  const cancellationReturnedToIdle =
    buttonByText("Preview ordered operations")?.disabled === false &&
    document.querySelector('[data-testid="mutation-preview-result"]') === null;
  assert(
    cancellationReturnedToIdle,
    "cancelled native preview leaked a stale result into the tray",
  );
  const cancellationSandboxCount = (await waitForSandboxCount(0, 20_000)).sandboxCount;
  await removeAllStaged();
  await sleep(100);
  assert(
    document.querySelector('[data-testid="mutation-preview-result"]') === null,
    "cancelled native preview appeared after the tray returned to idle",
  );

  root.unmount();
  const report: SmokeReport = {
    passed: true,
    message:
      "actual React tray -> production Tauri mutation bridge/commands -> disposable Rust backend passed ordered rewrite, conflict, stale, cancellation, and preview-only cleanup gates",
    rewriteKinds,
    orderedOperationSummaries,
    reorderOldOids: reorderEvidence.oldOids,
    reorderNewOids: reorderEvidence.newOids,
    cascadeParentOids: reorderEvidence.parentOids,
    conflictFiles,
    staleMessage,
    cancellationPreviewStarted,
    cancellationReturnedToIdle,
    confirmSandboxCount,
    conflictSandboxCount,
    cancellationSandboxCount,
    applyDisabled,
    eagerMaterializationCommandsRegistered: false,
  };
  status(`PASS\n${JSON.stringify(report, null, 2)}`);
  await tauri.core.invoke<void>("mutation_preview_native_smoke_complete", { report });
}

void run().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  status(`FAIL\n${message}`);
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) throw error;
  const report: SmokeReport = {
    passed: false,
    message,
    rewriteKinds: [],
    orderedOperationSummaries: [],
    reorderOldOids: [],
    reorderNewOids: [],
    cascadeParentOids: [],
    conflictFiles: [],
    staleMessage: "",
    cancellationPreviewStarted: false,
    cancellationReturnedToIdle: false,
    confirmSandboxCount: 999,
    conflictSandboxCount: 999,
    cancellationSandboxCount: 999,
    applyDisabled: false,
    eagerMaterializationCommandsRegistered: false,
  };
  await tauri.core.invoke<void>("mutation_preview_native_smoke_complete", { report });
});
