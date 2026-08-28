import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";

import { chromium } from "playwright";

const url =
  process.env.GITINSPECT_HEADED_WEBGL_URL ??
  "http://127.0.0.1:1420/mutation-preview-headed-webgl.html";
const browserCandidates = [
  process.env.GITINSPECT_CHROMIUM,
  "/home/user/bin/chromium",
  "/usr/bin/chromium",
].filter(Boolean);

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next explicit system-browser candidate.
    }
  }
  return chromium.executablePath();
}

async function isReachable(target) {
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(target, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(
        `Vite exited before the headed qualification page became reachable (${child.exitCode})`,
      );
    }
    if (await isReachable(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

function focusBrowserWindow() {
  const result = spawnSync("wmctrl", ["-a", "gitinspect Phase 38 headed WebGL"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function assertResult(result) {
  if (result?.passed !== true) {
    throw new Error(`headed WebGL page failed: ${result?.message ?? "missing result"}`);
  }
  if (result.provenance !== "browser-headed-hardware-webgl" || result.nativeFpsClaim !== false) {
    throw new Error("headed WebGL provenance contract changed");
  }
  if (!Array.isArray(result.runs) || result.runs.length !== 3) {
    throw new Error(`expected 3 headed WebGL runs, got ${result.runs?.length ?? 0}`);
  }
  const normalizedRenderer = String(result.renderer).toLowerCase();
  if (
    ["llvmpipe", "softpipe", "swiftshader", "software rasterizer"].some((marker) =>
      normalizedRenderer.includes(marker),
    )
  ) {
    throw new Error(`software WebGL renderer is not acceptable: ${result.renderer}`);
  }
  for (const run of result.runs) {
    if (
      run.samples !== 120 ||
      run.visibilityState !== "visible" ||
      run.documentHasFocus !== true ||
      run.visibilityChanges !== 0 ||
      run.blurEvents !== 0 ||
      run.maxGapVisibilityState !== "visible" ||
      run.maxGapDocumentHasFocus !== true
    ) {
      throw new Error(`headed WebGL run ${run.run} lost visibility/focus authority`);
    }
  }
  if (!result.accessibilityLive) {
    throw new Error("headed WebGL transformed-topology live-region evidence is missing");
  }
  if (
    (!result.accessibilityPressed || !result.accessibilityRoving) &&
    !result.accessibilityBlocker
  ) {
    throw new Error("headed WebGL projected-node accessibility failed without an explicit blocker");
  }
}

let server;
let browser;
try {
  if (!(await isReachable(url))) {
    server = spawn(
      "pnpm",
      ["exec", "vite", "--host", "127.0.0.1", "--port", "1420", "--strictPort"],
      {
        cwd: new URL("..", import.meta.url),
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    await waitForServer(url, server);
  }

  const executablePath = await firstExecutable(browserCandidates);
  browser = await chromium.launch({
    headless: false,
    executablePath,
    args: [
      "--disable-software-rasterizer",
      "--enable-gpu-rasterization",
      "--enable-zero-copy",
      "--window-size=1280,720",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`browser-console: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.bringToFront();
  const wmFocused = focusBrowserWindow();
  await page.evaluate(() => window.focus());
  await page.waitForFunction(
    () => document.visibilityState === "visible" && document.hasFocus(),
    undefined,
    { timeout: 10_000 },
  );
  const result = await page
    .waitForFunction(() => window.__GITINSPECT_PHASE38_HEADED_WEBGL_RESULT__, undefined, {
      timeout: 90_000,
    })
    .then((handle) => handle.jsonValue());
  assertResult(result);
  console.log(`wmctrl_focus=${wmFocused}`);
  console.log(`browser_executable=${executablePath}`);
  console.log(`GITINSPECT_PHASE38_HEADED_WEBGL=${JSON.stringify(result, null, 2)}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
}
