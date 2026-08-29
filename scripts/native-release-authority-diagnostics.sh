#!/usr/bin/env bash
set -euo pipefail

# Pure, desktop-independent diagnostics for persisted native qualification
# authority. This deliberately does not launch Tauri, touch X11/i3, click,
# refocus, or mutate the canonical native evidence.

authority_path='scripts/native-release-authority.json'
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

[[ "$authority_path" == /* ]] || authority_path="$repo_root/$authority_path"
[[ -f "$authority_path" ]] || { echo "authority manifest missing: $authority_path" >&2; exit 2; }

manifest_ok=$(jq -e '
  .schemaVersion == 1
  and (.nativeAuthorityPhase | type == "number")
  and (.summaryPath | type == "string" and length > 0)
  and (.summarySha256 | test("^[0-9a-f]{64}$"))
  and (.nativeHead | test("^[0-9a-f]{40}$"))
  and (.gatePath | type == "string" and length > 0)
  and (.gateSha256 | test("^[0-9a-f]{64}$"))
' "$authority_path" 2>/dev/null || true)
[[ "$manifest_ok" == 'true' ]] || { echo 'authority manifest malformed' >&2; exit 2; }

authority_summary=$(jq -r '.summaryPath' "$authority_path")
authority_summary_sha=$(jq -r '.summarySha256' "$authority_path")
expected_head=$(jq -r '.nativeHead' "$authority_path")
gate_path=$(jq -r '.gatePath' "$authority_path")
expected_gate_sha=$(jq -r '.gateSha256' "$authority_path")
[[ "$authority_summary" == /* ]] || authority_summary="$repo_root/$authority_summary"
[[ "$gate_path" == /* ]] || gate_path="$repo_root/$gate_path"

[[ -f "$gate_path" ]] || { echo "native gate missing: $gate_path" >&2; exit 2; }
actual_gate_sha=$(sha256sum "$gate_path" | awk '{print $1}')
if [[ "$actual_gate_sha" != "$expected_gate_sha" ]]; then
  printf 'authority_reject=gate-byte-mismatch expected=%s actual=%s\n' "$expected_gate_sha" "$actual_gate_sha" >&2
  exit 1
fi

[[ -f "$authority_summary" ]] || { echo "native summary missing: $authority_summary" >&2; exit 2; }
actual_summary_sha=$(sha256sum "$authority_summary" | awk '{print $1}')
if [[ "$actual_summary_sha" != "$authority_summary_sha" ]]; then
  printf 'authority_reject=canonical-summary-byte-mismatch expected=%s actual=%s\n' \
    "$authority_summary_sha" "$actual_summary_sha" >&2
  exit 1
fi

if [[ -n "$summary_override" ]]; then
  summary_path=$summary_override
  [[ "$summary_path" == /* ]] || summary_path="$repo_root/$summary_path"
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
  local platform
  platform=$(uname -s 2>/dev/null || printf unknown)
  if [[ "$platform" != 'Linux' ]]; then
    printf 'pidfd_feasibility=NOT_APPLICABLE platform=%s generic_requirement=false\n' "$platform"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo 'pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python3-unavailable generic_requirement=false'
    return 0
  fi
  python3 - <<'PY'
import os
import signal
import subprocess
import sys

if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
    print("pidfd_feasibility=NOT_AVAILABLE platform=Linux reason=python-api-unavailable generic_requirement=false")
    raise SystemExit(0)

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
try:
    fd = os.pidfd_open(child.pid, 0)
    try:
        signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        code = child.wait(timeout=5)
    finally:
        os.close(fd)
except (OSError, subprocess.TimeoutExpired) as exc:
    try:
        child.terminate()
        child.wait(timeout=2)
    except Exception:
        child.kill()
        child.wait()
    print(f"pidfd_feasibility=NOT_AVAILABLE platform=Linux reason={type(exc).__name__} generic_requirement=false")
    raise SystemExit(0)

print(f"pidfd_feasibility=AVAILABLE platform=Linux owned_child_exit={code} atomic_signal_handle=true generic_requirement=false")
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

  # Override validation is rooted in the manifest-pinned canonical bytes. A
  # caller cannot replace both the semantic baseline and candidate with the
  # same tampered copy while retaining the original manifest hash.
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
    || "$canonical_first" != authority_reject=canonical-summary-byte-mismatch* ]]; then
    printf 'self_test_failure=tampered-canonical-override first_exit=%s second_exit=%s output=%s\n' \
      "$canonical_first_exit" "$canonical_second_exit" "$canonical_first" >&2
    failures=$((failures + 1))
  else
    echo 'authority_rejection=PASS case=tampered-canonical-override deterministic=true exit=1'
  fi

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

  pidfd_feasibility

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
