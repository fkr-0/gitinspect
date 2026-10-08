#!/usr/bin/env node
// Headless-browser smoke test for the built WebAssembly edition.
// Serves a built directory, loads it, keeps it open, and fails on ANY uncaught
// exception, console error, failed/4xx/5xx request, page crash, or empty body.
// This is the gate that stops a page which crashes seconds after load from deploying.
//
// usage: node scripts/wasm-smoke.mjs <dist-dir> [entry.html] [--hold=SECONDS] [--shots=DIR]
// env:   PLAYWRIGHT_CHROMIUM_EXECUTABLE overrides the browser binary.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name, dflt) =>
  (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split("=")[1];
const positional = args.filter((a) => !a.startsWith("--"));
const dist = resolve(positional[0] ?? "");
const entry = positional[1] ?? "index.html";
const holdSeconds = Number(opt("hold", 25));
const shotsDir = opt("shots", "");
if (!positional[0]) {
  console.error("usage: wasm-smoke.mjs <dist-dir> [entry.html]");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(dist, path === "/" ? entry : path);
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
      .end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
});
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) =>
    failures.push(
      `${at()} uncaught exception: ${String(e.stack || e)
        .split("\n")
        .slice(0, 3)
        .join(" | ")}`,
    ),
  );
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`${at()} console.error: ${m.text().slice(0, 300)}`);
  });
  page.on("requestfailed", (r) =>
    failures.push(`${at()} request failed: ${r.url()} (${r.failure()?.errorText})`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`${at()} HTTP ${r.status()}: ${r.url()}`);
  });
  page.on("crash", () => failures.push(`${at()} page crashed`));
  await page.goto(url, { waitUntil: "load" });
  if (shotsDir) await mkdir(shotsDir, { recursive: true });
  const marks = [1, 5, Math.floor(holdSeconds / 2), holdSeconds].filter(
    (v, i, a) => v > 0 && a.indexOf(v) === i,
  );
  for (const s of marks) {
    await page.waitForTimeout(Math.max(0, s * 1000 - (Date.now() - t0)));
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();
    if (shotsDir) await page.screenshot({ path: join(shotsDir, `wasm-smoke-${s}s.png`) });
    console.log(`${at()} body ${text.length} chars: ${text.slice(0, 90)}`);
    if (!text) failures.push(`${at()} page body is empty`);
    if (/startup failed|failed to load/i.test(text))
      failures.push(`${at()} startup failure UI shown: ${text.slice(0, 120)}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(
    `wasm-smoke FAILED (${failures.length}):\n- ${[...new Set(failures)].join("\n- ")}`,
  );
  process.exit(1);
}
console.log(`wasm-smoke ok: ${url} stayed healthy for ${holdSeconds}s`);
