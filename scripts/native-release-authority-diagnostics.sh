#!/usr/bin/env bash
set -euo pipefail

# Pure, desktop-independent diagnostics for persisted native qualification
# authority. This deliberately does not launch Tauri, touch X11/i3, click,
# refocus, or mutate the canonical native evidence.

default_authority_path='scripts/native-release-authority.json'
authority_path=$default_authority_path
authority_override_requested=0
summary_override=''
evidence_dir=''
self_test=0

usage() {
  cat <<'EOF'
Usage: scripts/native-release-authority-diagnostics.sh [options]

Options:
  --authority PATH    Authority manifest (default: scripts/native-release-authority.json).
  --summary PATH      Validate a summary copy against the manifest's native HEAD/gate.
  --evidence-dir DIR  Also verify run-N-{raw,native-result,active-window} payload hashes.
  --self-test         Exercise malformed/stale/tampered summaries, payload hashes, lock
                      interruption/release semantics, and Linux pidfd feasibility.
  -h, --help          Show this help.

This command is pure release tooling. Unsupported pidfd platforms are reported, not
treated as generic verification failures. Native linux-x11-i3 qualification remains
owned by scripts/native-release-qualification.sh and is never launched here.
EOF
}

while (($# > 0)); do
  case "$1" in
    --authority)
      (($# >= 2)) || { echo 'missing value for --authority' >&2; exit 64; }
      authority_path=$2
      authority_override_requested=1
      shift
      ;;
    --summary)
      (($# >= 2)) || { echo 'missing value for --summary' >&2; exit 64; }
      summary_override=$2
      shift
      ;;
    --evidence-dir)
      (($# >= 2)) || { echo 'missing value for --evidence-dir' >&2; exit 64; }
      evidence_dir=$2
      shift
      ;;
    --self-test)
      self_test=1
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

for tool in awk bash cp date flock git head jq mv sha256sum sleep uname wc; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS=BLOCKED prerequisite=%s\n' "$tool" >&2
    exit 2
  }
done

manifest_shape_ok() {
  jq -e '
    .schemaVersion == 1
    and (.nativeAuthorityPhase | type == "number")
    and (.summaryPath | type == "string" and length > 0)
    and (.summarySha256 | test("^[0-9a-f]{64}$"))
    and (.nativeHead | test("^[0-9a-f]{40}$"))
    and (.gatePath | type == "string" and length > 0)
    and (.gateSha256 | test("^[0-9a-f]{64}$"))
  ' "$1" >/dev/null 2>&1
}

repo_local_existing_file() {
  local requested=$1 label=$2 absolute dir base canonical_dir canonical
  if [[ "$requested" == /* ]]; then
    absolute=$requested
  else
    absolute="$repo_root/$requested"
  fi
  [[ -f "$absolute" ]] || { printf '%s missing: %s\n' "$label" "$absolute" >&2; return 2; }
  [[ ! -L "$absolute" ]] || { printf '%s must not be a symlink: %s\n' "$label" "$absolute" >&2; return 2; }
  dir=${absolute%/*}
  base=${absolute##*/}
  canonical_dir=$(cd -P -- "$dir" 2>/dev/null && pwd) || {
    printf '%s parent is unavailable: %s\n' "$label" "$dir" >&2
    return 2
  }
  canonical="$canonical_dir/$base"
  case "$canonical" in
    "$repo_root"/*) ;;
    *) printf '%s must stay inside repository: %s\n' "$label" "$requested" >&2; return 2 ;;
  esac
  printf '%s\n' "$canonical"
}

manifest_repo_path() {
  local relative=$1 label=$2
  [[ "$relative" != /* ]] || { printf '%s must be repository-relative: %s\n' "$label" "$relative" >&2; return 2; }
  case "/$relative/" in
    *'/../'*|*'/./'*|*'//'*) printf '%s must be normalized: %s\n' "$label" "$relative" >&2; return 2 ;;
  esac
  [[ "$relative" != '.' && "$relative" != '..' ]] || {
    printf '%s must name a file: %s\n' "$label" "$relative" >&2
    return 2
  }
  printf '%s/%s\n' "$repo_root" "$relative"
}

authority_path=$(repo_local_existing_file "$authority_path" 'authority manifest') || exit $?
manifest_shape_ok "$authority_path" || { echo 'authority manifest malformed' >&2; exit 2; }

canonical_authority_path="$repo_root/$default_authority_path"
if ((authority_override_requested)) && [[ "$authority_path" != "$canonical_authority_path" ]]; then
  canonical_authority_path=$(repo_local_existing_file "$default_authority_path" 'canonical authority manifest') || exit $?
  manifest_shape_ok "$canonical_authority_path" || { echo 'canonical authority manifest malformed' >&2; exit 2; }
  override_summary_path=$(jq -r '.summaryPath' "$authority_path")
  override_gate_path=$(jq -r '.gatePath' "$authority_path")
  canonical_summary_path=$(jq -r '.summaryPath' "$canonical_authority_path")
  canonical_gate_path=$(jq -r '.gatePath' "$canonical_authority_path")
  if [[ "$override_summary_path" != "$canonical_summary_path" || "$override_gate_path" != "$canonical_gate_path" ]]; then
    printf 'authority_reject=path-substitution canonical_summary=%s candidate_summary=%s canonical_gate=%s candidate_gate=%s\n' \
      "$canonical_summary_path" "$override_summary_path" "$canonical_gate_path" "$override_gate_path" >&2
    exit 1
  fi
fi

authority_summary=$(jq -r '.summaryPath' "$authority_path")
authority_summary_sha=$(jq -r '.summarySha256' "$authority_path")
expected_head=$(jq -r '.nativeHead' "$authority_path")
gate_path=$(jq -r '.gatePath' "$authority_path")
expected_gate_sha=$(jq -r '.gateSha256' "$authority_path")
authority_summary=$(manifest_repo_path "$authority_summary" 'authority summary path') || exit $?
gate_path=$(manifest_repo_path "$gate_path" 'native gate path') || exit $?
gate_path=$(repo_local_existing_file "$gate_path" 'native gate') || exit $?
actual_gate_sha=$(sha256sum "$gate_path" | awk '{print $1}')
if [[ "$actual_gate_sha" != "$expected_gate_sha" ]]; then
  printf 'authority_reject=gate-byte-mismatch expected=%s actual=%s\n' "$expected_gate_sha" "$actual_gate_sha" >&2
  exit 1
fi

authority_summary=$(repo_local_existing_file "$authority_summary" 'native summary') || exit $?
actual_summary_sha=$(sha256sum "$authority_summary" | awk '{print $1}')
if [[ "$actual_summary_sha" != "$authority_summary_sha" ]]; then
  printf 'authority_reject=canonical-summary-byte-mismatch expected=%s actual=%s\n' \
    "$authority_summary_sha" "$actual_summary_sha" >&2
  exit 1
fi

if [[ -n "$summary_override" ]]; then
  summary_path=$(repo_local_existing_file "$summary_override" 'summary override') || exit $?
else
  summary_path=$authority_summary
fi

validate_summary() {
  local candidate=$1 payload_dir=${2:-}
  [[ -f "$candidate" ]] || { echo "authority_reject=summary-missing path=$candidate" >&2; return 1; }

  if ! jq -e --arg head "$expected_head" --arg gate "$expected_gate_sha" --slurpfile canonical "$authority_summary" '
    .schemaVersion == 1
    and .status == "PASS"
    and .head == $head
    and .nativeApplicability.lane == "linux-x11-i3"
    and .nativeApplicability.result == "APPLICABLE"
    and .contract == $canonical[0].contract
    and .desktop == $canonical[0].desktop
    and .sourceEvidence == $canonical[0].sourceEvidence
    and (.runs | length) == ($canonical[0].runs | length)
    and .contract.minimumSerializedRuns == 3
    and .contract.maxExternalHandoffsPerRun == 1
    and .contract.noContinuousRefocus == true
    and .contract.noSyntheticClicks == true
    and .contract.noHiddenHelperWindows == true
    and .contract.nativeFpsAuthority == true
    and .contract.browserSupplementalOnly == true
    and .contract.browserNativeFpsClaim == false
    and .sourceEvidence.gateSha256 == $gate
    and (.runs | type == "array" and length >= 3)
    and ([.runs[].run] == [range(1; (.runs | length) + 1)])
    and all(.runs[];
      . as $run
      | (($canonical[0].runs[] | select(.run == $run.run) | del(.evidence)) == ($run | del(.evidence)))
      and .processes.preflightNativeSmoke == 0
      and .processes.preflightOtherHeadedGitinspect == 0
      and .processes.handoffNativeSmoke == 1
      and .processes.handoffOtherHeadedGitinspect == 0
      and .workspace == $canonical[0].desktop.controlledWorkspace
      and .window.wmClass == "\"mutation_preview_native_smoke\", \"Mutation_preview_native_smoke\""
      and .window.title == "gitinspect"
      and .handoff.count == 1
      and .handoff.activeAfter == .window.id
      and .nativeExit == 0
      and .frame.samples >= 120
      and .frame.visibilityState == "visible"
      and .frame.documentHasFocus == true
      and .frame.visibilityChanges == 0
      and .frame.windowFocusEvents == 0
      and .frame.windowBlurEvents == 0
      and .frame.timingBlocker == ""
      and .accessibility.selectedSemanticId == "commit:ffffffffffffffffffffffffffffffff00000003"
      and .accessibility.live == true
      and .accessibility.pressed == true
      and .accessibility.exactlyOneRovingTabStop == true
      and .accessibility.blocker == ""
      and .accessibility.focusStable == true
      and .unrelatedActiveWindowTransitionsAfterHandoff == 0
      and ([.activeWindowTransitions[]
        | select(.phase == "post-handoff" and .activeWindow != $run.window.id and .activeWindow != "0x0")]
        | length) == 0
      and .passed == true
      and (.blockers | type == "array" and length == 0)
      and (.evidence.rawSha256 | test("^[0-9a-f]{64}$"))
      and (.evidence.activeWindowTransitionsSha256 | test("^[0-9a-f]{64}$"))
      and (.evidence.nativeResultSha256 | test("^[0-9a-f]{64}$"))
    )
  ' "$candidate" >/dev/null 2>&1; then
    echo "authority_reject=summary-contract path=$candidate" >&2
    return 1
  fi

  if [[ -n "$payload_dir" ]]; then
    local run expected actual file kind field
    while read -r run; do
      for kind in raw native-result active-window; do
        case "$kind" in
          raw) field='rawSha256'; file="$payload_dir/run-$run-raw.txt" ;;
          native-result) field='nativeResultSha256'; file="$payload_dir/run-$run-native-result.txt" ;;
          active-window) field='activeWindowTransitionsSha256'; file="$payload_dir/run-$run-active-window.tsv" ;;
        esac
        [[ -f "$file" ]] || {
          printf 'authority_reject=evidence-missing run=%s kind=%s path=%s\n' "$run" "$kind" "$file" >&2
          return 1
        }
        expected=$(jq -r --argjson run "$run" --arg field "$field" '.runs[] | select(.run == $run) | .evidence[$field]' "$candidate")
        actual=$(sha256sum "$file" | awk '{print $1}')
        if [[ "$actual" != "$expected" ]]; then
          printf 'authority_reject=evidence-hash-mismatch run=%s kind=%s expected=%s actual=%s\n' \
            "$run" "$kind" "$expected" "$actual" >&2
          return 1
        fi
      done
    done < <(jq -r '.runs[].run' "$candidate")
  fi

  return 0
}

pidfd_feasibility() {
  local forced_platform=${1:-} forced_python=${2:-auto} platform
  if [[ -n "$forced_platform" ]]; then
    platform=$forced_platform
  else
    platform=$(uname -s 2>/dev/null || printf unknown)
  fi
  if [[ "$platform" != 'Linux' ]]; then
    printf 'pidfd_feasibility=NOT_APPLICABLE platform=%s generic_requirement=false\n' "$platform"
    return 0
  fi
  if [[ "$forced_python" == 'unavailable' ]] || ! command -v python3 >/dev/null 2>&1; then
    echo 'pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python3-unavailable generic_requirement=false'
    return 0
  fi
  PIDFD_FORCE_API_UNAVAILABLE=$([[ "$forced_python" == 'api-unavailable' ]] && printf 1 || printf 0) python3 - <<'PY'
import errno
import os
import signal
import subprocess
import sys

if os.environ.get("PIDFD_FORCE_API_UNAVAILABLE") == "1" or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
    print("pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python-api-unavailable generic_requirement=false")
    raise SystemExit(0)


def proc_start_time(pid: int) -> int:
    data = open(f"/proc/{pid}/stat", "r", encoding="utf-8").read()
    close = data.rfind(")")
    if close < 0:
        raise RuntimeError("proc-stat-comm-delimiter-missing")
    tail = data[close + 2 :].split()
    if len(tail) < 20:
        raise RuntimeError("proc-stat-truncated")
    return int(tail[19])


def signal_exact_identity(pid, expected_start, sig, *, read_start=proc_start_time, open_pidfd=os.pidfd_open,
                          send_signal=signal.pidfd_send_signal, close_fd=os.close):
    pre_start = read_start(pid)
    if pre_start != expected_start:
        return "PREOPEN_IDENTITY_MISMATCH"
    fd = open_pidfd(pid, 0)
    try:
        post_start = read_start(pid)
        if post_start != expected_start:
            return "POSTOPEN_IDENTITY_MISMATCH"
        send_signal(fd, sig, None, 0)
        return "SIGNALED"
    finally:
        close_fd(fd)


synthetic_reads = iter((700, 701))
synthetic_signals = []
synthetic_closed = []
synthetic_result = signal_exact_identity(
    123,
    700,
    signal.SIGTERM,
    read_start=lambda _pid: next(synthetic_reads),
    open_pidfd=lambda _pid, _flags: 99,
    send_signal=lambda *_args: synthetic_signals.append(True),
    close_fd=lambda fd: synthetic_closed.append(fd),
)
if synthetic_result != "POSTOPEN_IDENTITY_MISMATCH" or synthetic_signals or synthetic_closed != [99]:
    print("pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=postopen-revalidation-self-test-failed generic_requirement=false")
    raise SystemExit(0)

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
try:
    expected_start = proc_start_time(child.pid)
    stale_result = signal_exact_identity(child.pid, expected_start + 1, signal.SIGTERM)
    if stale_result != "PREOPEN_IDENTITY_MISMATCH" or child.poll() is not None:
        raise RuntimeError("preopen-identity-rejection-failed")

    result = signal_exact_identity(child.pid, expected_start, signal.SIGTERM)
    if result != "SIGNALED":
        raise RuntimeError(f"unexpected-signal-result-{result}")
    code = child.wait(timeout=5)
except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
    try:
        child.terminate()
        child.wait(timeout=2)
    except Exception:
        child.kill()
        child.wait()
    print(f"pidfd_feasibility=NOT_AVAILABLE platform=Linux reason={type(exc).__name__} generic_requirement=false")
    raise SystemExit(0)

probe = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
probe_fd = os.pidfd_open(probe.pid, 0)
try:
    signal.pidfd_send_signal(probe_fd, signal.SIGTERM, None, 0)
    probe.wait(timeout=5)
    try:
        signal.pidfd_send_signal(probe_fd, signal.SIGTERM, None, 0)
    except ProcessLookupError:
        reuse_safe = True
    except OSError as exc:
        reuse_safe = exc.errno == errno.ESRCH
    else:
        reuse_safe = False
finally:
    if probe.poll() is None:
        probe.kill()
        probe.wait()
    os.close(probe_fd)

if not reuse_safe:
    print("pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=exited-pidfd-retarget-self-test-failed generic_requirement=false")
    raise SystemExit(0)

print(
    "pidfd_feasibility=AVAILABLE platform=Linux "
    f"owned_child_exit={code} exact_start_time_precheck=true postopen_revalidation=true "
    "fd_targeted_signal=true stale_identity_refused=true exited_pidfd_retarget=false generic_requirement=false"
)
PY
}

run_self_test() {
  local failures=0
  local runtime_root="$repo_root/.git/native-release-authority-diagnostics"
  local runtime_dir
  runtime_dir="$runtime_root/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$runtime_dir"
  trap 'rm -rf "$runtime_dir"' RETURN

  validate_summary "$summary_path" || failures=$((failures + 1))
  if ((failures == 0)); then
    echo 'authority_baseline=PASS canonical_summary_contract=true canonical_gate_bytes=true'
  fi

  expect_reject() {
    local name=$1 file=$2 payload=${3:-}
    local first_output second_output first_exit second_exit
    set +e
    first_output=$(validate_summary "$file" "$payload" 2>&1)
    first_exit=$?
    second_output=$(validate_summary "$file" "$payload" 2>&1)
    second_exit=$?
    set -e
    if [[ "$first_exit" == '0' || "$second_exit" == '0' \
      || "$first_exit" != "$second_exit" || "$first_output" != "$second_output" ]]; then
      printf 'self_test_failure=%s nondeterministic-or-accepted first_exit=%s second_exit=%s\n' \
        "$name" "$first_exit" "$second_exit" >&2
      failures=$((failures + 1))
    else
      printf 'authority_rejection=PASS case=%s deterministic=true exit=%s\n' "$name" "$first_exit"
    fi
  }

  printf '{"schemaVersion":1' >"$runtime_dir/malformed.json"
  expect_reject malformed-json "$runtime_dir/malformed.json"

  local summary_size
  summary_size=$(wc -c <"$summary_path")
  head -c "$((summary_size / 2))" "$summary_path" >"$runtime_dir/truncated.json"
  expect_reject truncated-json "$runtime_dir/truncated.json"

  jq '.head = "0000000000000000000000000000000000000001"' "$summary_path" >"$runtime_dir/stale-head.json"
  expect_reject stale-head "$runtime_dir/stale-head.json"

  jq '.sourceEvidence.gateSha256 = "1111111111111111111111111111111111111111111111111111111111111111"' \
    "$summary_path" >"$runtime_dir/stale-gate.json"
  expect_reject stale-gate "$runtime_dir/stale-gate.json"

  jq '.contract.readinessMarker = "tampered readiness"' "$summary_path" >"$runtime_dir/tampered-readiness.json"
  expect_reject tampered-readiness-marker "$runtime_dir/tampered-readiness.json"
  jq '.runs[0].window.wmClass = "tampered class"' "$summary_path" >"$runtime_dir/tampered-wm-class.json"
  expect_reject tampered-wm-class "$runtime_dir/tampered-wm-class.json"
  jq '.runs[0].window.title = "tampered title"' "$summary_path" >"$runtime_dir/tampered-title.json"
  expect_reject tampered-window-title "$runtime_dir/tampered-title.json"
  jq '.runs[0].workspace = "tampered-workspace"' "$summary_path" >"$runtime_dir/tampered-workspace.json"
  expect_reject tampered-workspace "$runtime_dir/tampered-workspace.json"
  jq '.runs[0].handoff.activeAfter = "0x999"' "$summary_path" >"$runtime_dir/tampered-handoff.json"
  expect_reject tampered-handoff-active-after "$runtime_dir/tampered-handoff.json"
  jq '.runs[0].activeWindowTransitions += [{timestampMs:999999,activeWindow:"0x999",workspace:"9",wmClass:"other",title:"other",phase:"post-handoff"}]' \
    "$summary_path" >"$runtime_dir/tampered-transition.json"
  expect_reject tampered-post-handoff-transition "$runtime_dir/tampered-transition.json"
  jq '.sourceEvidence.nativeRustSha256 = "2222222222222222222222222222222222222222222222222222222222222222"' \
    "$summary_path" >"$runtime_dir/tampered-native-rust.json"
  expect_reject tampered-native-rust-source "$runtime_dir/tampered-native-rust.json"

  # Copied-manifest override validation is rooted in the canonical manifest
  # path identity before any copied semantic baseline can be considered.
  local tampered_canonical="$runtime_dir/tampered-canonical.json"
  local tampered_candidate="$runtime_dir/tampered-candidate.json"
  local tampered_authority="$runtime_dir/tampered-authority.json"
  jq '.contract.readinessMarker = "jointly tampered readiness"' "$summary_path" >"$tampered_canonical"
  cp "$tampered_canonical" "$tampered_candidate"
  jq --arg summary "$tampered_canonical" --arg sha "$authority_summary_sha" \
    '.summaryPath = $summary | .summarySha256 = $sha' "$authority_path" >"$tampered_authority"
  local canonical_first canonical_second canonical_first_exit canonical_second_exit
  set +e
  canonical_first=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" \
    --authority "$tampered_authority" --summary "$tampered_candidate" 2>&1)
  canonical_first_exit=$?
  canonical_second=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" \
    --authority "$tampered_authority" --summary "$tampered_candidate" 2>&1)
  canonical_second_exit=$?
  set -e
  if [[ "$canonical_first_exit" != '1' || "$canonical_second_exit" != '1' \
    || "$canonical_first" != "$canonical_second" \
    || "$canonical_first" != authority_reject=path-substitution* ]]; then
    printf 'self_test_failure=tampered-canonical-override first_exit=%s second_exit=%s output=%s\n' \
      "$canonical_first_exit" "$canonical_second_exit" "$canonical_first" >&2
    failures=$((failures + 1))
  else
    echo 'authority_rejection=PASS case=tampered-canonical-override deterministic=true exit=1 path_rooted=true'
  fi

  # Copied --authority manifests are diagnostic input, not a replacement trust
  # root. A complete rotation is modeled separately in a disposable nested Git
  # repository where the rotated manifest is canonical for that fixture.
  local copied_authority="$runtime_dir/copied-authority.json"
  local substituted_summary="$runtime_dir/substituted-summary.json"
  local substituted_gate="$runtime_dir/substituted-gate.sh"
  cp "$authority_summary" "$substituted_summary"
  cp "$gate_path" "$substituted_gate"
  jq --arg summary ".git/native-release-authority-diagnostics/${runtime_dir##*/}/substituted-summary.json" \
    '.summaryPath = $summary' "$authority_path" >"$copied_authority"
  local substitution_first substitution_second substitution_first_exit substitution_second_exit
  set +e
  substitution_first=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" --authority "$copied_authority" 2>&1)
  substitution_first_exit=$?
  substitution_second=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" --authority "$copied_authority" 2>&1)
  substitution_second_exit=$?
  set -e
  if [[ "$substitution_first_exit" != '1' || "$substitution_second_exit" != '1' \
    || "$substitution_first" != "$substitution_second" || "$substitution_first" != authority_reject=path-substitution* ]]; then
    printf 'self_test_failure=summary-path-substitution first_exit=%s second_exit=%s output=%s\n' \
      "$substitution_first_exit" "$substitution_second_exit" "$substitution_first" >&2
    failures=$((failures + 1))
  else
    echo 'authority_rejection=PASS case=summary-path-substitution deterministic=true exit=1 equal_bytes=true'
  fi

  jq --arg gate ".git/native-release-authority-diagnostics/${runtime_dir##*/}/substituted-gate.sh" \
    '.gatePath = $gate' "$authority_path" >"$copied_authority"
  set +e
  substitution_first=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" --authority "$copied_authority" 2>&1)
  substitution_first_exit=$?
  substitution_second=$(bash "$repo_root/scripts/native-release-authority-diagnostics.sh" --authority "$copied_authority" 2>&1)
  substitution_second_exit=$?
  set -e
  if [[ "$substitution_first_exit" != '1' || "$substitution_second_exit" != '1' \
    || "$substitution_first" != "$substitution_second" || "$substitution_first" != authority_reject=path-substitution* ]]; then
    printf 'self_test_failure=gate-path-substitution first_exit=%s second_exit=%s output=%s\n' \
      "$substitution_first_exit" "$substitution_second_exit" "$substitution_first" >&2
    failures=$((failures + 1))
  else
    echo 'authority_rejection=PASS case=gate-path-substitution deterministic=true exit=1 equal_bytes=true'
  fi

  local rotation_repo="$runtime_dir/rotation-repo"
  local rotation_manifest_rel='scripts/native-release-authority.json'
  local rotation_gate_rel='scripts/native-release-qualification-v2.sh'
  local rotation_summary_rel='.ws-bridge/evidence/native-rotation-v2.json'
  local rotation_candidate_rel='.ws-bridge/evidence/native-rotation-v2-candidate.json'
  local rotation_manifest="$rotation_repo/$rotation_manifest_rel"
  local rotation_gate="$rotation_repo/$rotation_gate_rel"
  local rotation_summary="$rotation_repo/$rotation_summary_rel"
  local rotation_candidate="$rotation_repo/$rotation_candidate_rel"
  local rotation_head rotation_gate_sha rotation_summary_sha
  rotation_head=$(printf '48%.0s' {1..20})
  mkdir -p "$rotation_repo/scripts" "$rotation_repo/.ws-bridge/evidence"
  git -C "$rotation_repo" init -q
  cp "$gate_path" "$rotation_gate"
  printf '\n# simulated authority rotation fixture; never production authority\n' >>"$rotation_gate"
  rotation_gate_sha=$(sha256sum "$rotation_gate" | awk '{print $1}')
  jq --arg head "$rotation_head" --arg gate "$rotation_gate_sha" '
    .head = $head
    | .contract.readinessMarker = "SIMULATED ROTATION ONLY: coherent authority handoff"
    | .sourceEvidence.gateSha256 = $gate
    | .sourceEvidence.nativeBinarySha256 = "3333333333333333333333333333333333333333333333333333333333333333"
    | .sourceEvidence.nativeRustSha256 = "4444444444444444444444444444444444444444444444444444444444444444"
    | .sourceEvidence.nativeTsSha256 = "5555555555555555555555555555555555555555555555555555555555555555"
  ' "$summary_path" >"$rotation_summary"
  cp "$rotation_summary" "$rotation_candidate"
  rotation_summary_sha=$(sha256sum "$rotation_summary" | awk '{print $1}')
  jq -n --arg summary "$rotation_summary_rel" --arg summary_sha "$rotation_summary_sha" \
    --arg head "$rotation_head" --arg gate "$rotation_gate_rel" --arg gate_sha "$rotation_gate_sha" '{
      schemaVersion: 1,
      nativeAuthorityPhase: 48,
      summaryPath: $summary,
      summarySha256: $summary_sha,
      nativeHead: $head,
      gatePath: $gate,
      gateSha256: $gate_sha
    }' >"$rotation_manifest"

  fixture_diag() {
    (cd "$rotation_repo" && bash "$repo_root/scripts/native-release-authority-diagnostics.sh" "$@")
  }
  expect_cli_reject() {
    local name=$1
    shift
    local first_output second_output first_exit second_exit
    set +e
    first_output=$("$@" 2>&1)
    first_exit=$?
    second_output=$("$@" 2>&1)
    second_exit=$?
    set -e
    if [[ "$first_exit" == '0' || "$second_exit" == '0' \
      || "$first_exit" != "$second_exit" || "$first_output" != "$second_output" ]]; then
      printf 'self_test_failure=%s nondeterministic-or-accepted first_exit=%s second_exit=%s\n' \
        "$name" "$first_exit" "$second_exit" >&2
      failures=$((failures + 1))
    else
      printf 'authority_rotation_rejection=PASS case=%s deterministic=true exit=%s\n' "$name" "$first_exit"
    fi
  }

  local rotation_output rotation_exit
  set +e
  rotation_output=$(fixture_diag --summary "$rotation_candidate_rel" 2>&1)
  rotation_exit=$?
  set -e
  if [[ "$rotation_exit" != '0' || "$rotation_output" != *'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS=PASS'* \
    || "$rotation_output" != *"expected_native_head=$rotation_head"* \
    || "$rotation_output" != *"gate_sha256=$rotation_gate_sha"* ]]; then
    printf 'self_test_failure=complete-simulated-rotation exit=%s output=%s\n' "$rotation_exit" "$rotation_output" >&2
    failures=$((failures + 1))
  else
    printf 'authority_rotation=PASS simulated_only=true summary_path=%s native_head=%s gate_path=%s coherent_source_evidence=true coherent_candidate_semantics=true\n' \
      "$rotation_summary_rel" "$rotation_head" "$rotation_gate_rel"
  fi

  # Preserve the Phase-47 invariant that canonical summary bytes are hashed
  # before a --summary candidate override is semantically evaluated.
  cp "$rotation_summary" "$rotation_summary.good"
  jq '.contract.readinessMarker = "tampered canonical before candidate override"' \
    "$rotation_summary.good" >"$rotation_summary"
  cp "$rotation_summary" "$rotation_candidate"
  local canonical_sha_first canonical_sha_second canonical_sha_first_exit canonical_sha_second_exit
  set +e
  canonical_sha_first=$(fixture_diag --summary "$rotation_candidate_rel" 2>&1)
  canonical_sha_first_exit=$?
  canonical_sha_second=$(fixture_diag --summary "$rotation_candidate_rel" 2>&1)
  canonical_sha_second_exit=$?
  set -e
  if [[ "$canonical_sha_first_exit" != '1' || "$canonical_sha_second_exit" != '1' \
    || "$canonical_sha_first" != "$canonical_sha_second" \
    || "$canonical_sha_first" != authority_reject=canonical-summary-byte-mismatch* ]]; then
    printf 'self_test_failure=canonical-summary-sha-before-candidate first_exit=%s second_exit=%s output=%s\n' \
      "$canonical_sha_first_exit" "$canonical_sha_second_exit" "$canonical_sha_first" >&2
    failures=$((failures + 1))
  else
    echo 'authority_rejection=PASS case=canonical-summary-sha-before-summary-override deterministic=true exit=1'
  fi
  cp "$rotation_summary.good" "$rotation_summary"
  cp "$rotation_summary" "$rotation_candidate"

  cp "$rotation_manifest" "$rotation_manifest.good"
  jq '.summarySha256 = "6666666666666666666666666666666666666666666666666666666666666666"' \
    "$rotation_manifest.good" >"$rotation_manifest"
  expect_cli_reject rotation-stale-summary-sha fixture_diag --summary "$rotation_candidate_rel"

  jq '.nativeHead = "7777777777777777777777777777777777777777"' "$rotation_manifest.good" >"$rotation_manifest"
  expect_cli_reject rotation-stale-native-head fixture_diag --summary "$rotation_candidate_rel"

  jq '.gateSha256 = "8888888888888888888888888888888888888888888888888888888888888888"' \
    "$rotation_manifest.good" >"$rotation_manifest"
  expect_cli_reject rotation-stale-gate-sha fixture_diag --summary "$rotation_candidate_rel"

  jq '.summaryPath = ".ws-bridge/evidence/missing-rotation-summary.json"' \
    "$rotation_manifest.good" >"$rotation_manifest"
  expect_cli_reject rotation-missing-canonical-summary fixture_diag --summary "$rotation_candidate_rel"

  cp "$rotation_manifest.good" "$rotation_manifest"
  local rotation_substituted_summary_rel='.ws-bridge/evidence/native-rotation-v2-substitute.json'
  local rotation_substituted_summary="$rotation_repo/$rotation_substituted_summary_rel"
  cp "$rotation_summary" "$rotation_substituted_summary"
  local rotation_copied_authority="$rotation_repo/scripts/native-release-authority-copy.json"
  jq --arg summary "$rotation_substituted_summary_rel" '.summaryPath = $summary' \
    "$rotation_manifest.good" >"$rotation_copied_authority"
  expect_cli_reject rotation-summary-path-substitution fixture_diag --authority scripts/native-release-authority-copy.json \
    --summary "$rotation_candidate_rel"

  local stale_source_summary_rel='.ws-bridge/evidence/native-rotation-v2-stale-source.json'
  local stale_source_summary="$rotation_repo/$stale_source_summary_rel"
  jq --arg stale_gate "$expected_gate_sha" '.sourceEvidence.gateSha256 = $stale_gate' \
    "$rotation_summary" >"$stale_source_summary"
  local stale_source_sha
  stale_source_sha=$(sha256sum "$stale_source_summary" | awk '{print $1}')
  jq --arg summary "$stale_source_summary_rel" --arg sha "$stale_source_sha" \
    '.summaryPath = $summary | .summarySha256 = $sha' "$rotation_manifest.good" >"$rotation_manifest"
  expect_cli_reject rotation-partial-source-evidence fixture_diag

  cp "$rotation_manifest.good" "$rotation_manifest"
  local stale_candidate_rel='.ws-bridge/evidence/native-rotation-v2-stale-candidate.json'
  local stale_candidate="$rotation_repo/$stale_candidate_rel"
  jq --arg readiness "$(jq -r '.contract.readinessMarker' "$summary_path")" \
    '.contract.readinessMarker = $readiness' "$rotation_candidate" >"$stale_candidate"
  expect_cli_reject rotation-stale-candidate-semantics fixture_diag --summary "$stale_candidate_rel"

  cp "$rotation_manifest.good" "$rotation_manifest"
  echo 'authority_rotation_matrix=PASS simulated_authority_not_promoted=true production_manifest_unchanged=true'

  local fixture_dir="$runtime_dir/evidence"
  local fixture_summary="$runtime_dir/fixture-summary.json"
  mkdir -p "$fixture_dir"
  cp "$summary_path" "$fixture_summary"
  local run raw result transitions raw_sha result_sha transitions_sha tmp
  while read -r run; do
    raw="$fixture_dir/run-$run-raw.txt"
    result="$fixture_dir/run-$run-native-result.txt"
    transitions="$fixture_dir/run-$run-active-window.tsv"
    printf 'run=%s raw fixture\n' "$run" >"$raw"
    printf 'run=%s native result fixture\n' "$run" >"$result"
    printf '100%s\t0x5000003\t9\tfixture\tgitinspect\tpost-handoff\n' "$run" >"$transitions"
    cp "$raw" "$raw.orig"
    cp "$result" "$result.orig"
    cp "$transitions" "$transitions.orig"
    raw_sha=$(sha256sum "$raw" | awk '{print $1}')
    result_sha=$(sha256sum "$result" | awk '{print $1}')
    transitions_sha=$(sha256sum "$transitions" | awk '{print $1}')
    tmp="$fixture_summary.tmp"
    jq --argjson run "$run" --arg raw "$raw_sha" --arg result "$result_sha" --arg transitions "$transitions_sha" '
      (.runs[] | select(.run == $run) | .evidence.rawSha256) = $raw
      | (.runs[] | select(.run == $run) | .evidence.nativeResultSha256) = $result
      | (.runs[] | select(.run == $run) | .evidence.activeWindowTransitionsSha256) = $transitions
    ' "$fixture_summary" >"$tmp"
    mv "$tmp" "$fixture_summary"
  done < <(jq -r '.runs[].run' "$summary_path")

  if validate_summary "$fixture_summary" "$fixture_dir"; then
    echo 'evidence_bundle_baseline=PASS per_run_payload_hashes=true'
  else
    echo 'self_test_failure=synthetic evidence bundle rejected' >&2
    failures=$((failures + 1))
  fi

  while read -r run; do
    for kind in raw native-result active-window; do
      case "$kind" in
        raw) file="$fixture_dir/run-$run-raw.txt" ;;
        native-result) file="$fixture_dir/run-$run-native-result.txt" ;;
        active-window) file="$fixture_dir/run-$run-active-window.tsv" ;;
      esac
      printf 'tamper\n' >>"$file"
      expect_reject "run-$run-$kind-hash-tamper" "$fixture_summary" "$fixture_dir"
      cp "$file.orig" "$file"
    done
  done < <(jq -r '.runs[].run' "$fixture_summary")

  # Qualify the exact advisory-lock semantics used by the native gate without
  # touching X11 or the production qualification lock. The holder delays exit
  # after TERM, proving a contender stays blocked until the owner is truly gone.
  local lock="$runtime_dir/qualification.lock"
  local ready="$runtime_dir/lock-ready"
  local terminating="$runtime_dir/lock-terminating"
  local release="$runtime_dir/lock-release"
  LOCK_PATH="$lock" READY_PATH="$ready" TERMINATING_PATH="$terminating" RELEASE_PATH="$release" bash -c '
    set -euo pipefail
    exec 8>"$LOCK_PATH"
    flock -n 8
    printf "%s\n" "$$" >"$READY_PATH"
    trap '\''printf "term\n" >"$TERMINATING_PATH"; while [[ ! -e "$RELEASE_PATH" ]]; do read -r -t 0.05 _ || true; done; exit 143'\'' TERM
    while :; do read -r -t 0.1 _ || true; done
  ' &
  local holder=$!
  for _ in {1..100}; do [[ -s "$ready" ]] && break; sleep 0.01; done
  if [[ ! -s "$ready" ]] || flock -n "$lock" -c true 2>/dev/null; then
    echo 'self_test_failure=qualification-lock initial ownership not exclusive' >&2
    failures=$((failures + 1))
  fi
  kill -TERM "$holder" 2>/dev/null || true
  for _ in {1..100}; do [[ -s "$terminating" ]] && break; sleep 0.01; done
  if [[ ! -s "$terminating" ]] || ! kill -0 "$holder" 2>/dev/null || flock -n "$lock" -c true 2>/dev/null; then
    echo 'self_test_failure=qualification-lock released before owner termination' >&2
    failures=$((failures + 1))
  fi
  : >"$release"
  set +e
  wait "$holder"
  local holder_exit=$?
  set -e
  if [[ "$holder_exit" != '143' ]] || ! flock -n "$lock" -c true 2>/dev/null; then
    printf 'self_test_failure=qualification-lock post-termination release holder_exit=%s\n' "$holder_exit" >&2
    failures=$((failures + 1))
  else
    printf 'qualification_lock_interruption=PASS holder_exit=143 contender_blocked_until_owner_gone=true post_exit_reacquire=true stale_path_authority=false\n'
  fi

  local pidfd_not_applicable pidfd_no_python pidfd_no_api pidfd_actual
  pidfd_not_applicable=$(pidfd_feasibility Darwin)
  if [[ "$pidfd_not_applicable" != 'pidfd_feasibility=NOT_APPLICABLE platform=Darwin generic_requirement=false' ]]; then
    printf 'self_test_failure=pidfd-not-applicable output=%s\n' "$pidfd_not_applicable" >&2
    failures=$((failures + 1))
  fi
  pidfd_no_python=$(pidfd_feasibility Linux unavailable)
  if [[ "$pidfd_no_python" != 'pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python3-unavailable generic_requirement=false' ]]; then
    printf 'self_test_failure=pidfd-python-unavailable output=%s\n' "$pidfd_no_python" >&2
    failures=$((failures + 1))
  fi
  if command -v python3 >/dev/null 2>&1; then
    pidfd_no_api=$(pidfd_feasibility Linux api-unavailable)
    if [[ "$pidfd_no_api" != 'pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python-api-unavailable generic_requirement=false' ]]; then
      printf 'self_test_failure=pidfd-api-unavailable output=%s\n' "$pidfd_no_api" >&2
      failures=$((failures + 1))
    fi
  else
    pidfd_no_api='pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python3-unavailable generic_requirement=false'
  fi
  echo 'pidfd_portability=PASS non_linux_optional=true python_optional=true api_optional=true generic_requirement=false'
  pidfd_actual=$(pidfd_feasibility)
  printf '%s\n' "$pidfd_actual"
  if [[ "$pidfd_actual" != pidfd_feasibility=AVAILABLE* \
    && "$pidfd_actual" != pidfd_feasibility=NOT_AVAILABLE* \
    && "$pidfd_actual" != pidfd_feasibility=NOT_APPLICABLE* ]]; then
    printf 'self_test_failure=pidfd-actual-status output=%s\n' "$pidfd_actual" >&2
    failures=$((failures + 1))
  fi

  if ((failures != 0)); then
    printf 'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS_SELF_TEST=FAIL failures=%d\n' "$failures" >&2
    return 1
  fi
  echo 'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS_SELF_TEST=PASS'
}

if ((self_test)); then
  run_self_test
  exit $?
fi

if [[ -n "$evidence_dir" && "$evidence_dir" != /* ]]; then
  evidence_dir="$repo_root/$evidence_dir"
fi

if validate_summary "$summary_path" "$evidence_dir"; then
  printf 'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS=PASS\nsummary=%s\nexpected_native_head=%s\ngate_sha256=%s\n' \
    "$summary_path" "$expected_head" "$expected_gate_sha"
  exit 0
fi

echo 'NATIVE_RELEASE_AUTHORITY_DIAGNOSTICS=FAIL' >&2
exit 1
