#!/usr/bin/env node
// Browser-only WebGL context loss/recovery gate.
// Usage: node scripts/webgl-recovery-smoke.mjs apps/gitinspect/dist-wasm wasm.html --shots=artifacts/webgl-recovery
// PLAYWRIGHT_CHROMIUM_EXECUTABLE selects Chromium. Requires a scene with a WebGL canvas.
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
if (!positional[0]) {
  console.error("usage: webgl-recovery-smoke.mjs <dist-dir> [entry.html] [--shots=DIR]");
  process.exit(2);
}
const root = resolve(positional[0]);
const entry = positional[1] ?? "wasm.html";
const shots = resolve(args.find((arg) => arg.startsWith("--shots="))?.slice(8) ?? "artifacts/webgl-recovery");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = resolve(root, `.${pathname === "/" ? `/${entry}` : pathname}`);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === target) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const faults = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => faults.push(String(error)));
  page.on("crash", () => faults.push("browser page crashed"));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  const canvas = page.locator("canvas.viewport__canvas");
  await canvas.waitFor({ state: "visible", timeout: 15000 });
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: resolve(shots, "before.png") });
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas.viewport__canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WEBGL_lose_context unavailable");
    window.__webglRecoveryExtension = extension;
    extension.loseContext();
  });
  await page.getByText("3D graphics context lost").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: resolve(shots, "during.png") });
  await page.evaluate(() => window.__webglRecoveryExtension.restoreContext());
  await page.getByText("3D graphics context lost").waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas.viewport__canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    return gl && !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
  }, null, { timeout: 15000 });
  // Two animation frames allow the restored R3F loop to submit new work.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(shots, "after.png") });
  if (faults.length) throw new Error(`uncaught browser failures: ${faults.join("; ")}`);
  console.log("WebGL recovery PASS; screenshots:", shots);
} catch (error) {
  console.error("WebGL recovery FAIL:", error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
