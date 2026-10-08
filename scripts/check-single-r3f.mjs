#!/usr/bin/env node
// Guard: exactly one copy of React Three Fiber (and react/three) must exist.
// Two copies split the R3F context between <Canvas> and useThree/useFrame and
// crash the app with "R3F: Hooks can only be used within the Canvas component!".
//
// usage: node scripts/check-single-r3f.mjs [bundle-dir ...]
//   always checks pnpm-lock.yaml; also scans built JS in each bundle-dir.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// --- 1. lockfile: one resolved snapshot per singleton package ----------------
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const snapshots = lock.split(/^snapshots:\s*$/m)[1] ?? "";
const singletons = ["@react-three/fiber", "@react-three/drei", "three", "react", "react-dom"];
for (const name of singletons) {
  const keys = new Set();
  const re = new RegExp(`^  '?${name.replace(/[/@]/g, (c) => `\\${c}`)}@[^:]+:`, "gm");
  for (const m of snapshots.matchAll(re)) keys.add(m[0].trim().replace(/:$/, "").replace(/'/g, ""));
  if (keys.size > 1)
    problems.push(
      `lockfile resolves ${keys.size} copies of ${name}:\n    ${[...keys].join("\n    ")}`,
    );
}

// --- 2. bundles: R3F runtime appears once ------------------------------------
const MARKER = "Hooks can only be used within the Canvas component";
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".js") || p.endsWith(".mjs")) yield p;
  }
}
for (const dir of process.argv.slice(2)) {
  let count = 0;
  const where = [];
  for (const f of walk(dir)) {
    const n = readFileSync(f, "utf8").split(MARKER).length - 1;
    if (n) {
      count += n;
      where.push(`${f} x${n}`);
    }
  }
  if (count === 0) problems.push(`${dir}: no R3F runtime found (wrong directory or build?)`);
  else if (count > 1)
    problems.push(`${dir}: ${count} R3F runtimes bundled:\n    ${where.join("\n    ")}`);
  else console.log(`ok  ${dir}: single R3F runtime (${where[0]})`);
}

if (problems.length) {
  console.error(`check-single-r3f FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`ok  lockfile: single copy of ${singletons.join(", ")}`);
