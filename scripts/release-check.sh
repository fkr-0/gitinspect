#!/usr/bin/env bash
set -euo pipefail

mode="verify"
metadata_only=0

usage() {
  cat <<'EOF'
Usage: scripts/release-check.sh [--verify|--candidate] [--metadata-only]

  --verify         Run the complete local regression/build gate while reporting
                   candidate-only metadata blockers as warnings. (default)
  --candidate      Require release-candidate metadata in addition to all checks.
  --metadata-only  Skip test/build commands and inspect release metadata only.
EOF
}

while (($# > 0)); do
  case "$1" in
    --verify)
      mode="verify"
      ;;
    --candidate)
      mode="candidate"
      ;;
    --metadata-only)
      metadata_only=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

printf 'gitinspect release gate\nmode=%s\nhead=%s\nbranch=%s\n' \
  "$mode" \
  "$(git rev-parse HEAD)" \
  "$(git branch --show-current)"

MODE="$mode" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function cargoVersion(path) {
  const source = fs.readFileSync(path, 'utf8');
  const match = source.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`missing package version in ${path}`);
  return match[1];
}

const mode = process.env.MODE ?? 'verify';
const appPackage = readJson('apps/gitinspect/package.json');
const contractsPackage = readJson('packages/contracts/package.json');
const graphElementsPackage = readJson('packages/graph-elements/package.json');
const tauriConfig = readJson('apps/gitinspect/src-tauri/tauri.conf.json');
const tauriCargo = cargoVersion('apps/gitinspect/src-tauri/Cargo.toml');
const coreCargo = cargoVersion('crates/gitinspect-core/Cargo.toml');
const productVersion = String(tauriConfig.version);

const errors = [];
const warnings = [];
function candidateProblem(message) {
  if (mode === 'candidate') errors.push(message);
  else warnings.push(message);
}

if (tauriCargo !== productVersion) {
  errors.push(`Tauri Cargo version ${tauriCargo} != tauri.conf.json ${productVersion}`);
}
if (coreCargo !== productVersion) {
  errors.push(`gitinspect-core version ${coreCargo} != product version ${productVersion}`);
}
if (appPackage.version !== productVersion) {
  errors.push(`@gitinspect/app package version ${appPackage.version} != product version ${productVersion}`);
}
if (tauriConfig.bundle?.active !== true) {
  candidateProblem('Tauri bundle.active is not true; platform package production is not enabled');
}

const bundleRoot = path.resolve('apps/gitinspect/src-tauri');
function hasSymlinkComponent(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return false;
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}
const bundleIcons = Array.isArray(tauriConfig.bundle?.icon)
  ? tauriConfig.bundle.icon.filter((value) => typeof value === 'string' && value.length > 0)
  : [];
let squarePngIcon = false;
let windowsIcoIcon = false;
for (const icon of bundleIcons) {
  const resolved = path.resolve(bundleRoot, icon);
  if (resolved !== bundleRoot && !resolved.startsWith(`${bundleRoot}${path.sep}`)) {
    candidateProblem(`Tauri bundle icon escapes src-tauri: ${icon}`);
    continue;
  }
  if (hasSymlinkComponent(bundleRoot, resolved)) {
    candidateProblem(`Tauri bundle icon path must not traverse symlinks: ${icon}`);
    continue;
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    candidateProblem(`Tauri bundle icon is missing: ${icon}`);
    continue;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    candidateProblem(`Tauri bundle icon must be a regular non-symlink file: ${icon}`);
    continue;
  }
  const extension = path.extname(icon).toLowerCase();
  if (extension === '.ico') {
    const header = fs.readFileSync(resolved).subarray(0, 6);
    if (
      header.length < 6 ||
      header.readUInt16LE(0) !== 0 ||
      header.readUInt16LE(2) !== 1 ||
      header.readUInt16LE(4) < 1
    ) {
      candidateProblem(`Tauri bundle ICO icon has an invalid header: ${icon}`);
    } else {
      windowsIcoIcon = true;
    }
    continue;
  }
  if (extension !== '.png') continue;
  const header = fs.readFileSync(resolved).subarray(0, 24);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (header.length < 24 || !header.subarray(0, 8).equals(pngSignature)) {
    candidateProblem(`Tauri bundle PNG icon has an invalid header: ${icon}`);
    continue;
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width > 0 && width === height) squarePngIcon = true;
}
if (bundleIcons.length === 0) {
  candidateProblem('Tauri bundle.icon is empty; packaged desktop builds require explicit icon assets');
} else if (!squarePngIcon) {
  candidateProblem('Tauri bundle.icon has no valid square PNG; Linux AppImage packaging requires one');
}
if (!windowsIcoIcon) {
  candidateProblem('Tauri bundle.icon has no valid ICO; Windows MSI packaging requires one');
}

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const escapedVersion = productVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionHeading = new RegExp(`^##\\s+(?:\\[)?${escapedVersion}(?:\\])?(?:\\s|$)`, 'm');
if (!versionHeading.test(changelog)) {
  const message = `CHANGELOG.md has no release heading for ${productVersion}; work remains under Unreleased`;
  candidateProblem(message);
}

console.log(`product_version=${productVersion}`);
console.log(`tauri_cargo_version=${tauriCargo}`);
console.log(`core_cargo_version=${coreCargo}`);
console.log(`app_package_version=${appPackage.version}`);
console.log(`contracts_private_version=${contractsPackage.version}`);
console.log(`graph_elements_private_version=${graphElementsPackage.version}`);
console.log(`bundle_active=${String(tauriConfig.bundle?.active === true)}`);
console.log(`bundle_icon_count=${bundleIcons.length}`);
console.log(`bundle_square_png=${String(squarePngIcon)}`);
console.log(`bundle_windows_ico=${String(windowsIcoIcon)}`);
for (const warning of warnings) console.log(`warning=${warning}`);
for (const error of errors) console.error(`error=${error}`);
if (errors.length > 0) process.exit(2);
NODE

if ((metadata_only)); then
  echo "release_metadata=pass"
  exit 0
fi

run_step() {
  local name=$1
  shift
  printf '\n=== %s ===\n' "$name"
  "$@"
}

run_step "workspace typecheck" pnpm typecheck
run_step "workspace tests" pnpm test
run_step "workspace build" pnpm build
run_step "workspace lint" pnpm lint

core_manifest="crates/gitinspect-core/Cargo.toml"
run_step "gitinspect-core fmt" cargo fmt --manifest-path "$core_manifest" -- --check
run_step "gitinspect-core clippy" cargo clippy --manifest-path "$core_manifest" --all-targets -- -D warnings
run_step "gitinspect-core tests" cargo test --manifest-path "$core_manifest"

tauri_manifest="apps/gitinspect/src-tauri/Cargo.toml"
run_step "Tauri fmt" cargo fmt --manifest-path "$tauri_manifest" -- --check
run_step "Tauri clippy" cargo clippy --manifest-path "$tauri_manifest" --all-targets -- -D warnings
run_step "Tauri tests" cargo test --manifest-path "$tauri_manifest"
run_step "Tauri check" cargo check --manifest-path "$tauri_manifest" --all-targets
run_step "Git whitespace check (index + worktree)" git diff --check HEAD --

printf '\nrelease_verification=pass\n'
if [[ "$mode" == "verify" ]]; then
  echo "candidate_metadata=not_enforced"
else
  echo "candidate_metadata=pass"
fi
