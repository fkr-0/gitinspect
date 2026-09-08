#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function classifyArtifact(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.endsWith(".appimage")) return { kind: "linux-appimage", platform: "linux" };
  if (normalized.endsWith(".deb")) return { kind: "linux-deb", platform: "linux" };
  if (normalized.endsWith(".rpm")) return { kind: "linux-rpm", platform: "linux" };
  if (normalized.endsWith(".dmg")) return { kind: "macos-dmg", platform: "darwin" };
  if (normalized.endsWith(".msi")) return { kind: "windows-msi", platform: "win32" };
  if (normalized.endsWith(".exe") && normalized.includes("nsis")) {
    return { kind: "windows-nsis", platform: "win32" };
  }
  return undefined;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDelimitedToken(filename, token) {
  const value = String(token);
  if (value.length === 0) return false;
  const pattern = new RegExp(`(^|[^0-9A-Za-z])${escapeRegex(value)}([^0-9A-Za-z]|$)`, "i");
  return pattern.test(filename);
}

function walkFiles(root, current = root) {
  const files = [];
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      if (classifyArtifact(relative)) {
        fail("SYMLINK_ARTIFACT", `bundle audit refuses symbolic release artifacts: ${relative}`);
      }
      continue;
    }
    if (stat.isDirectory()) {
      if (entry.name.endsWith(".AppDir")) continue;
      files.push(...walkFiles(root, absolute));
      continue;
    }
    if (!stat.isFile()) {
      if (classifyArtifact(relative)) {
        fail("UNSUPPORTED_FILE_TYPE", `release artifact is not a regular file: ${relative}`);
      }
      continue;
    }
    files.push(absolute);
  }
  return files;
}

function gitHead(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function auditBundle({
  bundleDir,
  expectedVersion,
  productName = "gitinspect",
  platform,
  cwd = repoRoot,
}) {
  const resolvedRoot = path.resolve(bundleDir);
  if (!fs.existsSync(resolvedRoot)) fail("BUNDLE_DIR_MISSING", `bundle directory is missing: ${resolvedRoot}`);
  if (!fs.statSync(resolvedRoot).isDirectory()) {
    fail("BUNDLE_DIR_INVALID", `bundle path is not a directory: ${resolvedRoot}`);
  }

  const files = walkFiles(resolvedRoot);
  const artifacts = [];
  for (const file of files) {
    const relative = path.relative(resolvedRoot, file);
    const classification = classifyArtifact(relative);
    if (!classification) continue;
    const stat = fs.statSync(file);
    if (stat.size <= 0) fail("EMPTY_ARTIFACT", `release artifact is empty: ${relative}`);
    const basename = path.basename(file);
    if (!hasDelimitedToken(basename, productName)) {
      fail("PRODUCT_NAME_MISMATCH", `artifact name does not contain exact product token '${productName}': ${relative}`);
    }
    if (!hasDelimitedToken(basename, expectedVersion)) {
      fail("VERSION_MISMATCH", `artifact name does not contain exact release version token '${expectedVersion}': ${relative}`);
    }
    const executable = (stat.mode & 0o111) !== 0;
    if (classification.kind === "linux-appimage" && !executable) {
      fail("ARTIFACT_NOT_EXECUTABLE", `AppImage release artifact is not executable: ${relative}`);
    }
    artifacts.push({
      path: relative.replaceAll("\\", "/"),
      absolutePath: file,
      kind: classification.kind,
      platform: classification.platform,
      sizeBytes: stat.size,
      sha256: sha256File(file),
      executable,
    });
  }

  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  if (artifacts.length === 0) fail("NO_RELEASE_ARTIFACTS", `no recognized release artifacts found in ${resolvedRoot}`);
  if (platform && !artifacts.some((artifact) => artifact.platform === platform)) {
    fail("PLATFORM_ARTIFACT_MISSING", `no release artifact for platform '${platform}' found in ${resolvedRoot}`);
  }

  return {
    schemaVersion: 1,
    productName,
    version: String(expectedVersion),
    platform: platform ?? null,
    head: gitHead(cwd) ?? null,
    bundleDir: path.relative(cwd, resolvedRoot).replaceAll("\\", "/"),
    artifacts: artifacts.map(({ absolutePath: _absolutePath, ...artifact }) => artifact),
  };
}

function parseArgs(argv) {
  const options = {
    bundleDir: path.join(repoRoot, "apps/gitinspect/src-tauri/target/release/bundle"),
    output: "",
    expectedVersion: "",
    platform: "",
    productName: "gitinspect",
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--bundle-dir" || arg === "--output" || arg === "--expected-version" || arg === "--platform" || arg === "--product-name") {
      const value = argv[index + 1];
      if (!value) fail("USAGE", `missing value for ${arg}`);
      index += 1;
      if (arg === "--bundle-dir") options.bundleDir = value;
      if (arg === "--output") options.output = value;
      if (arg === "--expected-version") options.expectedVersion = value;
      if (arg === "--platform") options.platform = value;
      if (arg === "--product-name") options.productName = value;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage: node scripts/release-package-audit.mjs [options]\n\nOptions:\n  --bundle-dir PATH\n  --output PATH\n  --expected-version VERSION\n  --platform linux|darwin|win32\n  --product-name NAME\n  --self-test\n`);
      process.exit(0);
    }
    fail("USAGE", `unknown argument: ${arg}`);
  }
  return options;
}

function packageVersion() {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps/gitinspect/src-tauri/tauri.conf.json"), "utf8"));
  return String(config.version);
}

function writeJsonAtomic(destination, value) {
  const absolute = path.resolve(destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, absolute);
}

function expectFailure(code, callback) {
  try {
    callback();
  } catch (error) {
    if (error?.code === code) return;
    throw error;
  }
  fail("SELF_TEST_FAILURE", `expected failure ${code}`);
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitinspect-package-audit-"));
  try {
    const valid = path.join(root, "valid");
    fs.mkdirSync(valid);
    const artifact = path.join(valid, "gitinspect_0.2.1_amd64.AppImage");
    fs.writeFileSync(artifact, "fixture");
    fs.chmodSync(artifact, 0o755);
    const appDir = path.join(valid, "gitinspect.AppDir");
    fs.mkdirSync(appDir);
    fs.symlinkSync(artifact, path.join(appDir, ".DirIcon"));
    const manifest = auditBundle({ bundleDir: valid, expectedVersion: "0.2.1", platform: "linux", cwd: root });
    if (manifest.artifacts.length !== 1 || manifest.artifacts[0].kind !== "linux-appimage" || !manifest.artifacts[0].executable) {
      fail("SELF_TEST_FAILURE", "valid AppImage fixture was not classified exactly");
    }

    expectFailure("VERSION_MISMATCH", () => auditBundle({ bundleDir: valid, expectedVersion: "9.9.9", platform: "linux", cwd: root }));
    expectFailure("PLATFORM_ARTIFACT_MISSING", () => auditBundle({ bundleDir: valid, expectedVersion: "0.2.1", platform: "darwin", cwd: root }));

    const versionPrefix = path.join(root, "version-prefix");
    fs.mkdirSync(versionPrefix);
    const wrongVersionArtifact = path.join(versionPrefix, "gitinspect_0.2.10_amd64.AppImage");
    fs.writeFileSync(wrongVersionArtifact, "fixture");
    fs.chmodSync(wrongVersionArtifact, 0o755);
    expectFailure("VERSION_MISMATCH", () => auditBundle({ bundleDir: versionPrefix, expectedVersion: "0.2.1", platform: "linux", cwd: root }));

    const productSuffix = path.join(root, "product-suffix");
    fs.mkdirSync(productSuffix);
    const wrongProductArtifact = path.join(productSuffix, "gitinspectpro_0.2.1_amd64.AppImage");
    fs.writeFileSync(wrongProductArtifact, "fixture");
    fs.chmodSync(wrongProductArtifact, 0o755);
    expectFailure("PRODUCT_NAME_MISMATCH", () => auditBundle({ bundleDir: productSuffix, expectedVersion: "0.2.1", platform: "linux", cwd: root }));

    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(empty, "gitinspect_0.2.1_amd64.AppImage"), "");
    expectFailure("EMPTY_ARTIFACT", () => auditBundle({ bundleDir: empty, expectedVersion: "0.2.1", platform: "linux", cwd: root }));

    const nonExecutable = path.join(root, "non-executable");
    fs.mkdirSync(nonExecutable);
    fs.writeFileSync(path.join(nonExecutable, "gitinspect_0.2.1_amd64.AppImage"), "fixture");
    expectFailure("ARTIFACT_NOT_EXECUTABLE", () => auditBundle({ bundleDir: nonExecutable, expectedVersion: "0.2.1", platform: "linux", cwd: root }));

    const linked = path.join(root, "linked");
    fs.mkdirSync(linked);
    fs.symlinkSync(artifact, path.join(linked, "gitinspect_0.2.1_amd64.AppImage"));
    expectFailure("SYMLINK_ARTIFACT", () => auditBundle({ bundleDir: linked, expectedVersion: "0.2.1", platform: "linux", cwd: root }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("RELEASE_PACKAGE_AUDIT_SELF_TEST=PASS");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  const expectedVersion = options.expectedVersion || packageVersion();
  const manifest = auditBundle({
    bundleDir: options.bundleDir,
    expectedVersion,
    productName: options.productName,
    platform: options.platform || undefined,
  });
  if (options.output) writeJsonAtomic(options.output, manifest);
  console.log(JSON.stringify(manifest, null, 2));
  console.log("RELEASE_PACKAGE_AUDIT=PASS");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`RELEASE_PACKAGE_AUDIT=FAIL code=${error?.code ?? "ERROR"} message=${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
