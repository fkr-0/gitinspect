#!/usr/bin/env bash
set -euo pipefail

allow_dirty_diagnostic=0
bundle_dir=''
summary_path=''

usage() {
  cat <<'EOF'
Usage: scripts/release-package-qualification.sh [options]

Build and execute the Linux AppImage release artifact. The default mode is a
fail-closed release qualification and requires a clean tracked worktree.

Options:
  --allow-dirty-diagnostic  Permit a dirty tracked worktree, but mark the result
                            DIAGNOSTIC_PASS with releaseQualified=false.
  --bundle-dir PATH         Override the AppImage bundle directory.
  --summary PATH            Override the machine-readable result filename; it
                            must resolve directly inside this worktree's Git metadata.
  --self-test               Run only the package-auditor self-test.
  -h, --help                Show this help.
EOF
}

self_test=0
while (($# > 0)); do
  case "$1" in
    --allow-dirty-diagnostic) allow_dirty_diagnostic=1 ;;
    --bundle-dir)
      (($# >= 2)) || { echo 'missing value for --bundle-dir' >&2; exit 64; }
      bundle_dir=$2
      shift
      ;;
    --summary)
      (($# >= 2)) || { echo 'missing value for --summary' >&2; exit 64; }
      summary_path=$2
      shift
      ;;
    --self-test) self_test=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

if ((self_test)); then
  node scripts/release-package-audit.mjs --self-test
  exit $?
fi

platform=$(uname -s 2>/dev/null || printf unknown)
if [[ "$platform" != 'Linux' ]]; then
  printf 'RELEASE_PACKAGE_QUALIFICATION=NOT_APPLICABLE platform=%s lane=linux-appimage\n' "$platform"
  exit 2
fi

for tool in git node pnpm sha256sum mktemp; do
  command -v "$tool" >/dev/null || {
    printf 'RELEASE_PACKAGE_QUALIFICATION=PREREQUISITE_UNAVAILABLE tool=%s\n' "$tool" >&2
    exit 2
  }
done

bundle_root="$repo_root/apps/gitinspect/src-tauri/target/release/bundle"
if [[ -z "$bundle_dir" ]]; then
  bundle_dir="$bundle_root/appimage"
elif [[ "$bundle_dir" != /* ]]; then
  bundle_dir="$repo_root/$bundle_dir"
fi
set +e
bundle_dir=$(node - "$repo_root" "$bundle_root" "$bundle_dir" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [repoRoot, bundleRootInput, candidateInput] = process.argv.slice(2);
const repo = path.resolve(repoRoot);
const bundleRoot = path.resolve(bundleRootInput);
const candidate = path.resolve(candidateInput);
const relative = path.relative(bundleRoot, candidate);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
  console.error(`unsafe --bundle-dir: expected a direct child of ${bundleRoot}`);
  process.exit(64);
}
let current = repo;
for (const segment of path.relative(repo, candidate).split(path.sep)) {
  current = path.join(current, segment);
  if (!fs.existsSync(current)) continue;
  if (fs.lstatSync(current).isSymbolicLink()) {
    console.error(`unsafe --bundle-dir: symlink path component ${current}`);
    process.exit(64);
  }
}
process.stdout.write(candidate);
NODE
)
bundle_path_exit=$?
set -e
((bundle_path_exit == 0)) || exit "$bundle_path_exit"
git_dir=$(git rev-parse --absolute-git-dir)
if [[ -z "$summary_path" ]]; then
  summary_path="$git_dir/gitinspect-package-qualification.json"
elif [[ "$summary_path" != /* ]]; then
  summary_path="$repo_root/$summary_path"
fi
set +e
summary_path=$(node - "$git_dir" "$summary_path" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [gitDirInput, candidateInput] = process.argv.slice(2);
const gitDir = path.resolve(gitDirInput);
const candidate = path.resolve(candidateInput);
const relative = path.relative(gitDir, candidate);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
  console.error(`unsafe --summary: expected a direct child of ${gitDir}`);
  process.exit(64);
}
try {
  if (fs.lstatSync(candidate).isSymbolicLink()) {
    console.error(`unsafe --summary: symlink target ${candidate}`);
    process.exit(64);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
process.stdout.write(candidate);
NODE
)
summary_path_exit=$?
set -e
((summary_path_exit == 0)) || exit "$summary_path_exit"
mkdir -p "$repo_root/tmp"
runtime_dir=$(mktemp -d "$repo_root/tmp/release-package-qualification.XXXXXX")
cleanup_runtime() {
  rm -rf -- "$runtime_dir"
}
trap cleanup_runtime EXIT INT TERM
rm -f \
  "$summary_path" \
  "$summary_path.artifacts.json" \
  "$summary_path.build.txt" \
  "$summary_path.prebundle-smoke.txt" \
  "$summary_path.smoke.txt"

dirty=$(git status --porcelain --untracked-files=normal)
release_qualified=true
status=PASS
if [[ -n "$dirty" ]]; then
  if ((allow_dirty_diagnostic == 0)); then
    printf 'RELEASE_PACKAGE_QUALIFICATION=FAIL reason=tracked-or-untracked-worktree-not-clean\n' >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  fi
  release_qualified=false
  status=DIAGNOSTIC_PASS
fi

printf 'package_gate_head=%s\n' "$(git rev-parse HEAD)"
printf 'package_gate_clean=%s\n' "$([[ -z "$dirty" ]] && printf true || printf false)"
printf 'package_gate_mode=%s\n' "$([[ "$release_qualified" == true ]] && printf release || printf diagnostic)"

# Candidate metadata and full source/native checks remain the prerequisite for
# packaging. Dirty diagnostic mode intentionally runs the same gate; the only
# relaxation is whether the resulting artifact may be called release-qualified.
pnpm release:candidate

pnpm --filter @gitinspect/app exec tauri --version
version=$(node -p "require('./apps/gitinspect/package.json').version")
rm -rf "$bundle_dir"
build_log="$summary_path.build.txt"
runtime_build_log="$runtime_dir/build.txt"
set +e
# linuxdeploy's bundled strip does not understand SHT_RELR sections emitted by
# current rolling-release system libraries. NO_STRIP is linuxdeploy's supported
# escape hatch; preserving symbols is preferable to corrupting/rejecting inputs.
NO_STRIP=1 pnpm --filter @gitinspect/app exec tauri build --bundles appimage >"$runtime_build_log" 2>&1
build_exit=$?
set -e
cp -- "$runtime_build_log" "$build_log"
cat "$build_log"

if ((build_exit != 0)); then
  build_sha=$(sha256sum "$build_log" | awk '{print $1}')
  head=$(git rev-parse HEAD)
  recorded_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  failure_status=FAIL
  failure_reason=tauri-appimage-build-failed
  failure_exit=1
  if grep -Eiq 'Downloading https?://' "$build_log" \
    && grep -Eiq 'failed to lookup address|failed to download|connection|network|No address associated|timed out' "$build_log"; then
    failure_status=PREREQUISITE_UNAVAILABLE
    failure_reason=tauri-appimage-network-prerequisite-unavailable
    failure_exit=2
  fi

  release_binary="$repo_root/apps/gitinspect/src-tauri/target/release/gitinspect-app"
  prebundle_smoke_status=not-run
  prebundle_smoke_sha=''
  prebundle_smoke_output="$summary_path.prebundle-smoke.txt"
  if [[ -x "$release_binary" ]]; then
    set +e
    "$release_binary" --release-smoke --repository "$repo_root" >"$prebundle_smoke_output" 2>&1
    prebundle_smoke_exit=$?
    set -e
    if ((prebundle_smoke_exit == 0)) \
      && grep -qx 'GITINSPECT_PACKAGED_RELEASE_SMOKE=PASS' "$prebundle_smoke_output" \
      && grep -qx "product_version=$version" "$prebundle_smoke_output" \
      && grep -qx 'original_apply_authorized=false' "$prebundle_smoke_output"; then
      prebundle_smoke_status=pass
      prebundle_smoke_sha=$(sha256sum "$prebundle_smoke_output" | awk '{print $1}')
    else
      prebundle_smoke_status=fail
    fi
  fi

  node -e '
const fs = require("node:fs");
const path = require("node:path");
const [summaryPath, status, reason, head, recordedAt, buildExit, buildLog, buildSha, binary, smokeStatus, smokePath, smokeSha] = process.argv.slice(1);
const summary = {
  schemaVersion: 1,
  status,
  releaseQualified: false,
  lane: "linux-appimage",
  reason,
  head,
  recordedAt,
  build: {
    exitCode: Number(buildExit),
    outputPath: path.relative(process.cwd(), buildLog),
    outputSha256: buildSha,
  },
  prebundleBinarySmoke: {
    status: smokeStatus,
    binaryPath: path.relative(process.cwd(), binary),
    outputPath: fs.existsSync(smokePath) ? path.relative(process.cwd(), smokePath) : null,
    outputSha256: smokeSha || null,
    originalApplyAuthorized: false,
  },
  remediation: status === "PREREQUISITE_UNAVAILABLE"
    ? "Provide the Tauri AppImage bundler helper through reachable network/cache or an approved TAURI_BUNDLER_TOOLS_GITHUB_MIRROR(_TEMPLATE), then rerun the clean package gate."
    : "Fix the AppImage build failure and rerun the package gate.",
};
const tmp = `${summaryPath}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tmp, summaryPath);
' "$summary_path" "$failure_status" "$failure_reason" "$head" "$recorded_at" "$build_exit" "$build_log" "$build_sha" "$release_binary" "$prebundle_smoke_status" "$prebundle_smoke_output" "$prebundle_smoke_sha"

  summary_sha=$(sha256sum "$summary_path" | awk '{print $1}')
  printf 'RELEASE_PACKAGE_QUALIFICATION=%s reason=%s\n' "$failure_status" "$failure_reason" >&2
  if [[ "$failure_status" == 'PREREQUISITE_UNAVAILABLE' ]]; then
    printf '%s\n' 'remediation=provide cached/reachable Tauri AppImage helper or approved TAURI_BUNDLER_TOOLS_GITHUB_MIRROR(_TEMPLATE)' >&2
  fi
  printf 'prebundle_binary_smoke=%s\n' "$prebundle_smoke_status" >&2
  printf 'summary=%s\n' "$summary_path" >&2
  printf 'summary_sha256=%s\n' "$summary_sha" >&2
  exit "$failure_exit"
fi

build_sha=$(sha256sum "$build_log" | awk '{print $1}')

artifact_manifest="$summary_path.artifacts.json"
node scripts/release-package-audit.mjs \
  --bundle-dir "$bundle_dir" \
  --expected-version "$version" \
  --platform linux \
  --output "$artifact_manifest" >/dev/null

mapfile -t appimages < <(node -e '
const fs = require("node:fs");
const path = require("node:path");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const root = process.argv[2];
for (const artifact of manifest.artifacts.filter((item) => item.kind === "linux-appimage")) {
  console.log(path.resolve(root, artifact.path));
}
' "$artifact_manifest" "$bundle_dir")

if ((${#appimages[@]} != 1)); then
  printf 'RELEASE_PACKAGE_QUALIFICATION=FAIL reason=expected-exactly-one-appimage count=%d\n' "${#appimages[@]}" >&2
  exit 1
fi

appimage=${appimages[0]}
[[ -x "$appimage" ]] || {
  printf 'RELEASE_PACKAGE_QUALIFICATION=FAIL reason=appimage-not-executable path=%s\n' "$appimage" >&2
  exit 1
}

smoke_output="$summary_path.smoke.txt"
set +e
APPIMAGE_EXTRACT_AND_RUN=1 "$appimage" --release-smoke --repository "$repo_root" >"$smoke_output" 2>&1
smoke_exit=$?
set -e
if ((smoke_exit != 0)) \
  || ! grep -qx 'GITINSPECT_PACKAGED_RELEASE_SMOKE=PASS' "$smoke_output" \
  || ! grep -qx "product_version=$version" "$smoke_output" \
  || ! grep -qx 'original_apply_authorized=false' "$smoke_output"; then
  printf 'RELEASE_PACKAGE_QUALIFICATION=FAIL reason=packaged-runtime-smoke exit=%d\n' "$smoke_exit" >&2
  cat "$smoke_output" >&2
  exit 1
fi

smoke_sha=$(sha256sum "$smoke_output" | awk '{print $1}')
head=$(git rev-parse HEAD)
recorded_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
node -e '
const fs = require("node:fs");
const path = require("node:path");
const [manifestPath, summaryPath, status, releaseQualified, head, recordedAt, buildLog, buildSha, smokePath, smokeSha] = process.argv.slice(1);
const artifacts = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const summary = {
  schemaVersion: 1,
  status,
  releaseQualified: releaseQualified === "true",
  lane: "linux-appimage",
  head,
  recordedAt,
  packaging: {
    noStrip: true,
    reason: "linuxdeploy bundled strip is incompatible with SHT_RELR sections on current rolling-release libraries",
    buildOutputPath: path.relative(process.cwd(), buildLog),
    buildOutputSha256: buildSha,
  },
  artifacts,
  smoke: {
    command: "APPIMAGE_EXTRACT_AND_RUN=1 <artifact> --release-smoke --repository <repo>",
    exitCode: 0,
    outputPath: path.relative(process.cwd(), smokePath),
    outputSha256: smokeSha,
    repositoryAuthority: "read-only gitinspect-core open",
    originalApplyAuthorized: false,
  },
};
const tmp = `${summaryPath}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tmp, summaryPath);
' "$artifact_manifest" "$summary_path" "$status" "$release_qualified" "$head" "$recorded_at" "$build_log" "$build_sha" "$smoke_output" "$smoke_sha"

summary_sha=$(sha256sum "$summary_path" | awk '{print $1}')
printf 'RELEASE_PACKAGE_QUALIFICATION=%s\n' "$status"
printf 'release_qualified=%s\n' "$release_qualified"
printf 'appimage=%s\n' "$appimage"
printf 'summary=%s\n' "$summary_path"
printf 'summary_sha256=%s\n' "$summary_sha"
