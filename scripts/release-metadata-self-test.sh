#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
product_version=$(node -e 'const c=require(process.argv[1]); process.stdout.write(String(c.version))' "$repo_root/apps/gitinspect/src-tauri/tauri.conf.json")
fixture_root="$repo_root/tmp/release-metadata-self-test-${BASHPID:-$$}"

cleanup() {
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$fixture_root/scripts" \
  "$fixture_root/apps/gitinspect/src-tauri" \
  "$fixture_root/crates/gitinspect-core" \
  "$fixture_root/packages/contracts" \
  "$fixture_root/packages/graph-elements"

cp "$repo_root/scripts/release-check.sh" "$fixture_root/scripts/release-check.sh"
cp "$repo_root/apps/gitinspect/package.json" "$fixture_root/apps/gitinspect/package.json"
cp "$repo_root/apps/gitinspect/src-tauri/tauri.conf.json" "$fixture_root/apps/gitinspect/src-tauri/tauri.conf.json"
cp "$repo_root/apps/gitinspect/src-tauri/Cargo.toml" "$fixture_root/apps/gitinspect/src-tauri/Cargo.toml"
cp "$repo_root/crates/gitinspect-core/Cargo.toml" "$fixture_root/crates/gitinspect-core/Cargo.toml"
cp "$repo_root/packages/contracts/package.json" "$fixture_root/packages/contracts/package.json"
cp "$repo_root/packages/graph-elements/package.json" "$fixture_root/packages/graph-elements/package.json"
cp "$repo_root/CHANGELOG.md" "$fixture_root/CHANGELOG.md"

git -C "$fixture_root" init -q -b main
git -C "$fixture_root" config user.name "GitInspect release metadata self-test"
git -C "$fixture_root" config user.email "release-metadata-self-test@gitinspect.invalid"
git -C "$fixture_root" add .
git -C "$fixture_root" commit -qm baseline

restore_fixture() {
  git -C "$fixture_root" checkout -q -- .
}

run_gate() {
  local mode=$1
  local output_var=$2
  local rc_var=$3
  local gate_output gate_rc

  set +e
  gate_output=$(cd "$fixture_root" && bash scripts/release-check.sh "$mode" --metadata-only 2>&1)
  gate_rc=$?
  set -e

  printf -v "$output_var" '%s' "$gate_output"
  printf -v "$rc_var" '%s' "$gate_rc"
}

expect_gate() {
  local label=$1
  local mode=$2
  local expected_rc=$3
  shift 3
  local output rc needle

  run_gate "$mode" output rc
  if [[ "$rc" -ne "$expected_rc" ]]; then
    printf 'FAIL %s: expected exit %s, got %s\n%s\n' "$label" "$expected_rc" "$rc" "$output" >&2
    exit 1
  fi
  for needle in "$@"; do
    if [[ "$output" != *"$needle"* ]]; then
      printf 'FAIL %s: missing output %q\n%s\n' "$label" "$needle" "$output" >&2
      exit 1
    fi
  done
  printf 'PASS %s\n' "$label"
}

mutate_json() {
  local relative_path=$1
  local expression=$2
  (
    cd "$fixture_root"
    node - "$relative_path" "$expression" <<'NODE'
const fs = require('node:fs');
const [path, expression] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, 'utf8'));
Function('value', expression)(value);
fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
NODE
  )
}

mutate_cargo_version() {
  local relative_path=$1
  local replacement=$2
  (
    cd "$fixture_root"
    node - "$relative_path" "$replacement" <<'NODE'
const fs = require('node:fs');
const [path, replacement] = process.argv.slice(2);
const source = fs.readFileSync(path, 'utf8');
const changed = source.replace(/^version\s*=\s*"[^"]+"/m, `version = "${replacement}"`);
if (changed === source) throw new Error(`version field not found in ${path}`);
fs.writeFileSync(path, changed);
NODE
  )
}

expect_gate baseline --candidate 0 \
  'release_metadata=pass' \
  'bundle_active=true'

restore_fixture
mutate_json apps/gitinspect/package.json 'value.version = "9.9.9";'
expect_gate app-version-mismatch --candidate 2 \
  "error=@gitinspect/app package version 9.9.9 != product version $product_version"

restore_fixture
mutate_cargo_version apps/gitinspect/src-tauri/Cargo.toml 9.9.9
expect_gate tauri-cargo-version-mismatch --candidate 2 \
  "error=Tauri Cargo version 9.9.9 != tauri.conf.json $product_version"

restore_fixture
mutate_cargo_version crates/gitinspect-core/Cargo.toml 9.9.9
expect_gate core-version-mismatch --candidate 2 \
  "error=gitinspect-core version 9.9.9 != product version $product_version"

restore_fixture
mutate_json apps/gitinspect/src-tauri/tauri.conf.json 'value.bundle.active = false;'
expect_gate disabled-bundling --candidate 2 \
  'error=Tauri bundle.active is not true; platform package production is not enabled'

restore_fixture
node - "$fixture_root/CHANGELOG.md" "$product_version" <<'NODE'
const fs = require('node:fs');
const [path, productVersion] = process.argv.slice(2);
const source = fs.readFileSync(path, 'utf8');
const escaped = productVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changed = source.replace(new RegExp(`^## \\[${escaped}\\].*$`, 'm'), '## [9.9.9] - 2099-01-01');
if (changed === source) throw new Error(`${productVersion} changelog heading not found`);
fs.writeFileSync(path, changed);
NODE
expect_gate missing-release-heading --candidate 2 \
  "error=CHANGELOG.md has no release heading for $product_version; work remains under Unreleased"

restore_fixture
mutate_json apps/gitinspect/package.json 'value.version = "9.9.9";'
mutate_json apps/gitinspect/src-tauri/tauri.conf.json 'value.bundle.active = false;'
node - "$fixture_root/CHANGELOG.md" "$product_version" <<'NODE'
const fs = require('node:fs');
const [path, productVersion] = process.argv.slice(2);
const source = fs.readFileSync(path, 'utf8');
const escaped = productVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
fs.writeFileSync(path, source.replace(new RegExp(`^## \\[${escaped}\\].*$`, 'm'), '## [9.9.9] - 2099-01-01'));
NODE
expect_gate verify-warns-but-does-not-enforce-candidate-metadata --verify 0 \
  "warning=@gitinspect/app package version 9.9.9 != product version $product_version" \
  'warning=Tauri bundle.active is not true; platform package production is not enabled' \
  "warning=CHANGELOG.md has no release heading for $product_version; work remains under Unreleased" \
  'release_metadata=pass'

printf 'RELEASE_METADATA_SELF_TEST=PASS\n'
