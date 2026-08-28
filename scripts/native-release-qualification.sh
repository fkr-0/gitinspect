#!/usr/bin/env bash
set -euo pipefail

# Fail-closed native Tauri qualification gate for the mutation-preview release path.
#
# This gate intentionally owns only desktop isolation/provenance around the existing
# mutation_preview_native_smoke binary. It does not click, continuously refocus,
# manufacture hidden windows, change projection/LOD semantics, or make any original
# repository mutation available.

readonly REQUIRED_RUNS=3
readonly READY_MARKER='MUTATION_PREVIEW_NATIVE_SMOKE_PROGRESS=headed native focus handoff ready after GraphScene/WebGL convergence…'
readonly EXPECTED_SELECTED_ID='commit:ffffffffffffffffffffffffffffffff00000003'
readonly EXPECTED_CLASS='mutation_preview_native_smoke'
readonly EXPECTED_WM_CLASS='"mutation_preview_native_smoke", "Mutation_preview_native_smoke"'
readonly EXPECTED_TITLE='gitinspect'
readonly SERVER_URL='http://127.0.0.1:1420/mutation-preview-native-smoke.html'

runs=$REQUIRED_RUNS
requested_workspace=${GITINSPECT_NATIVE_WORKSPACE:-}
summary_path=''
self_test=0

classify_headed_runner() {
  local executable=${1:-}
  local argv=${2:-}
  local base=${executable##*/}

  case "$base" in
    mutation_preview_native_smoke|native_visual_smoke|native_bridge_smoke|gitinspect)
      printf '%s\n' "$base"
      return 0
      ;;
    node)
      if [[ "$argv" =~ (^|[[:space:]])([^[:space:]]*/)?mutation-preview-headed-webgl\.mjs([[:space:]]|$) ]]; then
        printf '%s\n' 'browser-headed-webgl'
        return 0
      fi
      ;;
    cargo)
      if [[ "$argv" =~ (^|[[:space:]])--bin(=|[[:space:]]+)mutation_preview_native_smoke([[:space:]]|$) ]]; then
        printf '%s\n' 'cargo-mutation-preview-native-smoke'
        return 0
      fi
      if [[ "$argv" =~ (^|[[:space:]])--bin(=|[[:space:]]+)native_visual_smoke([[:space:]]|$) ]]; then
        printf '%s\n' 'cargo-native-visual-smoke'
        return 0
      fi
      if [[ "$argv" =~ (^|[[:space:]])--bin(=|[[:space:]]+)native_bridge_smoke([[:space:]]|$) ]]; then
        printf '%s\n' 'cargo-native-bridge-smoke'
        return 0
      fi
      ;;
  esac
  return 1
}

wm_class_matches_expected() {
  [[ ${1:-} == "$EXPECTED_WM_CLASS" ]]
}

transition_is_unrelated_after_handoff() {
  local phase=${1:-}
  local active_window=${2:-0x0}
  local target_window=${3:-0x0}
  [[ "$phase" == 'post-handoff' && "$active_window" != "$target_window" && "$active_window" != '0x0' ]]
}

run_self_test() {
  local failures=0 actual=''

  assert_runner() {
    local expected=$1 executable=$2 argv=$3
    actual=$(classify_headed_runner "$executable" "$argv" 2>/dev/null || true)
    if [[ "$actual" != "$expected" ]]; then
      printf 'self_test_failure=runner expected=%s actual=%s executable=%s argv=%s\n' "$expected" "$actual" "$executable" "$argv" >&2
      failures=$((failures + 1))
    fi
  }

  assert_no_runner() {
    local executable=$1 argv=$2
    actual=$(classify_headed_runner "$executable" "$argv" 2>/dev/null || true)
    if [[ -n "$actual" ]]; then
      printf 'self_test_failure=false-positive runner=%s executable=%s argv=%s\n' "$actual" "$executable" "$argv" >&2
      failures=$((failures + 1))
    fi
  }

  assert_runner mutation_preview_native_smoke /repo/target/debug/mutation_preview_native_smoke '/repo/target/debug/mutation_preview_native_smoke'
  assert_runner gitinspect /usr/bin/gitinspect '/usr/bin/gitinspect'
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/cargo 'cargo run --manifest-path app/Cargo.toml --bin mutation_preview_native_smoke'
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/cargo 'cargo run --bin=mutation_preview_native_smoke'
  assert_runner cargo-native-visual-smoke /usr/bin/cargo 'cargo run --bin native_visual_smoke'
  assert_runner cargo-native-bridge-smoke /usr/bin/cargo 'cargo run --bin native_bridge_smoke'
  assert_runner browser-headed-webgl /usr/bin/node 'node /repo/scripts/mutation-preview-headed-webgl.mjs --headed'
  assert_no_runner /usr/bin/cargo 'cargo run --bin mutation_preview_native_smoke_extra'
  assert_no_runner /usr/bin/node 'node /repo/scripts/mutation-preview-headed-webgl.mjs.backup'
  assert_no_runner /usr/bin/bash 'bash -c echo mutation_preview_native_smoke'

  wm_class_matches_expected "$EXPECTED_WM_CLASS" || { echo 'self_test_failure=exact WM_CLASS rejected' >&2; failures=$((failures + 1)); }
  if wm_class_matches_expected '"mutation_preview_native_smoke", "Other"'; then
    echo 'self_test_failure=non-exact WM_CLASS accepted' >&2
    failures=$((failures + 1))
  fi

  transition_is_unrelated_after_handoff post-handoff 0x99 0x42 || { echo 'self_test_failure=post-handoff unrelated transition missed' >&2; failures=$((failures + 1)); }
  if transition_is_unrelated_after_handoff pre-handoff 0x99 0x42; then
    echo 'self_test_failure=pre-handoff transition misclassified' >&2
    failures=$((failures + 1))
  fi
  if transition_is_unrelated_after_handoff post-handoff 0x42 0x42; then
    echo 'self_test_failure=target transition misclassified' >&2
    failures=$((failures + 1))
  fi
  if transition_is_unrelated_after_handoff post-handoff 0x0 0x42; then
    echo 'self_test_failure=zero active window misclassified' >&2
    failures=$((failures + 1))
  fi

  if ((failures != 0)); then
    printf 'NATIVE_RELEASE_QUALIFICATION_SELF_TEST=FAIL failures=%d\n' "$failures" >&2
    return 1
  fi
  echo 'NATIVE_RELEASE_QUALIFICATION_SELF_TEST=PASS'
}

usage() {
  cat <<'EOF'
Usage: scripts/native-release-qualification.sh [options]

Options:
  --runs N          Run N serialized native qualifications (minimum 3; default 3).
  --workspace NAME  Use NAME only if it does not already exist in i3.
                    Without this flag, the gate discovers an absent numeric workspace.
  --summary PATH    Write machine-readable JSON provenance to PATH.
  --self-test       Run pure provenance/classification regressions only.
  -h, --help        Show this help.

The gate is intentionally fail-closed. It requires X11+i3, an absent workspace that
can be created without stealing unrelated windows, zero competing headed Gitinspect
runners, the exact native GraphScene/WebGL readiness marker, one external wmctrl
handoff at most, and unchanged strict native semantic/focus acceptance.
EOF
}

while (($# > 0)); do
  case "$1" in
    --runs)
      (($# >= 2)) || { echo 'missing value for --runs' >&2; exit 64; }
      runs=$2
      shift
      ;;
    --workspace)
      (($# >= 2)) || { echo 'missing value for --workspace' >&2; exit 64; }
      requested_workspace=$2
      shift
      ;;
    --summary)
      (($# >= 2)) || { echo 'missing value for --summary' >&2; exit 64; }
      summary_path=$2
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

if ((self_test)); then
  run_self_test
  exit $?
fi

[[ "$runs" =~ ^[0-9]+$ ]] || { echo '--runs must be an integer' >&2; exit 64; }
((runs >= REQUIRED_RUNS)) || {
  echo "--runs may not weaken native acceptance below $REQUIRED_RUNS" >&2
  exit 64
}

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

if [[ -z "$summary_path" ]]; then
  summary_path="$repo_root/.git/gitinspect-native-release-qualification-summary.json"
elif [[ "$summary_path" != /* ]]; then
  summary_path="$repo_root/$summary_path"
fi
mkdir -p "$(dirname "$summary_path")"

runtime_root="$repo_root/.git/native-release-qualification"
runtime_dir="$runtime_root/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$runtime_dir"

original_workspace=''
controlled_workspace=''
switched_workspace=0
started_server_pid=''
active_run_pid=''
active_monitor_pid=''
active_alive_file=''
cleanup_complete=0

now_iso() {
  date --iso-8601=ns
}

now_ms() {
  date +%s%3N
}

normalize_window_id() {
  local raw=${1:-0x0}
  if [[ "$raw" =~ ^0x[0-9A-Fa-f]+$ ]]; then
    printf '0x%x' "$((raw))"
  else
    printf '0x0'
  fi
}

active_window_id() {
  local raw
  raw=$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | grep -o '0x[0-9A-Fa-f]\+' | head -n 1 || true)
  normalize_window_id "${raw:-0x0}"
}

client_window_ids() {
  xprop -root _NET_CLIENT_LIST 2>/dev/null \
    | grep -o '0x[0-9A-Fa-f]\+' \
    | while read -r id; do normalize_window_id "$id"; echo; done \
    | sort -u
}

window_class() {
  local id=$1
  xprop -id "$id" WM_CLASS 2>/dev/null \
    | sed -n 's/^WM_CLASS([^)]*) = //p'
}

window_title() {
  local id=$1
  xprop -id "$id" _NET_WM_NAME 2>/dev/null \
    | sed -n 's/^_NET_WM_NAME([^)]*) = //p' \
    | sed 's/^"//; s/"$//'
}

workspace_exists() {
  local name=$1
  i3-msg -t get_workspaces \
    | jq -e --arg name "$name" 'any(.[]; .name == $name)' >/dev/null
}

focused_workspace() {
  i3-msg -t get_workspaces | jq -r '.[] | select(.focused == true) | .name' | head -n 1
}

workspace_windows() {
  local name=$1
  i3-msg -t get_tree \
    | jq -r --arg name "$name" '
        ([.. | objects | select(.type? == "workspace" and .name? == $name)][0] // empty)
        | .. | objects | select(.window? != null) | .window
      '
}

workspace_window_count() {
  local name=$1
  workspace_windows "$name" | awk 'NF {count += 1} END {print count + 0}'
}

window_workspace() {
  local id=$1
  local decimal=$((id))
  i3-msg -t get_tree \
    | jq -r --argjson window "$decimal" '
        [.. | objects
          | select(.type? == "workspace")
          | select(([.. | objects | .window? // empty] | index($window)) != null)
          | .name][0] // ""
      '
}

headed_runner_processes() {
  local pid executable rest argv kind
  while read -r pid executable rest; do
    [[ -n "$pid" && -n "$executable" ]] || continue
    argv=$executable
    [[ -n "$rest" ]] && argv+=" $rest"
    kind=$(classify_headed_runner "$executable" "$argv" 2>/dev/null || true)
    [[ -n "$kind" ]] || continue
    printf '%s\t%s\t%s %s\n' "$pid" "$kind" "$pid" "$argv"
  done < <(ps -ww -eo pid=,args=)
}

native_smoke_process_count() {
  headed_runner_processes | awk -F '\t' '$2 == "mutation_preview_native_smoke" {count += 1} END {print count + 0}'
}

other_headed_runner_count() {
  headed_runner_processes | awk -F '\t' '$2 != "mutation_preview_native_smoke" {count += 1} END {print count + 0}'
}

field_value() {
  local file=$1 key=$2
  awk -v key="$key" 'index($0, key "=") == 1 {print substr($0, length(key) + 2); exit}' "$file"
}

cleanup() {
  if ((cleanup_complete)); then
    return
  fi
  cleanup_complete=1

  if [[ -n "$active_run_pid" ]]; then
    kill "$active_run_pid" 2>/dev/null || true
    wait "$active_run_pid" 2>/dev/null || true
  fi
  if [[ -n "$active_alive_file" ]]; then
    rm -f "$active_alive_file"
  fi
  if [[ -n "$active_monitor_pid" ]]; then
    wait "$active_monitor_pid" 2>/dev/null || true
  fi

  if [[ -n "$started_server_pid" ]]; then
    kill -TERM -- "-$started_server_pid" 2>/dev/null || true
    wait "$started_server_pid" 2>/dev/null || true
  fi

  if ((switched_workspace)) && [[ -n "$original_workspace" ]]; then
    i3-msg workspace "$original_workspace" >/dev/null 2>&1 || true
  fi

  rm -rf "$runtime_dir"
}

on_exit() {
  local exit_code=$?
  trap - EXIT INT TERM
  cleanup
  exit "$exit_code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

write_environment_blocker() {
  local blocker=$1
  local recorded_at
  recorded_at=$(now_iso)
  jq -n \
    --arg status 'BLOCKED_ENVIRONMENT' \
    --arg blocker "$blocker" \
    --arg recordedAt "$recorded_at" \
    --arg head "$(git rev-parse HEAD)" \
    '{schemaVersion:1,status:$status,environmentBlocker:$blocker,recordedAt:$recordedAt,head:$head,runs:[]}' \
    >"$summary_path"
  printf 'NATIVE_RELEASE_QUALIFICATION=BLOCKED_ENVIRONMENT\n'
  printf 'environment_blocker=%s\n' "$blocker"
  printf 'summary=%s\n' "$summary_path"
  exit 2
}

for tool in awk bash cargo curl date grep i3-msg jq pnpm ps readlink sed setsid sha256sum sort ss tr wmctrl xprop; do
  command -v "$tool" >/dev/null || write_environment_blocker "required tool unavailable: $tool"
done

[[ -n "${DISPLAY:-}" ]] || write_environment_blocker 'DISPLAY is unset; X11 native qualification is unavailable'
i3-msg -t get_version >/dev/null 2>&1 || write_environment_blocker 'i3 IPC is unavailable on the active X11 session'
xprop -root _NET_ACTIVE_WINDOW >/dev/null 2>&1 || write_environment_blocker 'X11 root-window focus authority is unavailable'

original_workspace=$(focused_workspace)
[[ -n "$original_workspace" ]] || write_environment_blocker 'i3 has no focused workspace to restore after qualification'

if [[ -n "$requested_workspace" ]]; then
  if workspace_exists "$requested_workspace"; then
    count=$(workspace_window_count "$requested_workspace")
    write_environment_blocker "requested controlled workspace '$requested_workspace' already exists (window_count=$count); refusing to steal or reuse it"
  fi
  controlled_workspace=$requested_workspace
else
  for candidate in 9 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29; do
    if ! workspace_exists "$candidate"; then
      controlled_workspace=$candidate
      break
    fi
  done
  [[ -n "$controlled_workspace" ]] || write_environment_blocker 'no absent controlled i3 workspace is available in the bounded candidate set'
fi

preexisting_native=$(native_smoke_process_count)
preexisting_other=$(other_headed_runner_count)
if ((preexisting_native != 0 || preexisting_other != 0)); then
  runners=$(headed_runner_processes | tr '\n' ';')
  write_environment_blocker "competing headed Gitinspect runner detected before qualification: native=$preexisting_native other=$preexisting_other processes=$runners"
fi

validate_server() {
  local body
  body=$(curl -fsS --max-time 2 "$SERVER_URL" 2>/dev/null || true)
  [[ "$body" == *'<title>gitinspect mutation preview native smoke</title>'* ]] \
    && [[ "$body" == *'/src/mutationPreviewNativeSmoke.tsx'* ]]
}

listener_pid=$(ss -ltnp '( sport = :1420 )' 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)
if [[ -n "$listener_pid" ]]; then
  listener_cwd=$(readlink -f "/proc/$listener_pid/cwd" 2>/dev/null || true)
  [[ "$listener_cwd" == "$repo_root/apps/gitinspect" ]] \
    || write_environment_blocker "port 1420 is owned outside this Gitinspect app workspace (pid=$listener_pid cwd=${listener_cwd:-unknown})"
  validate_server \
    || write_environment_blocker "port 1420 listener pid=$listener_pid does not serve the expected native smoke fixture"
  server_mode='validated-existing-repo-vite'
else
  server_log="$runtime_dir/vite.log"
  setsid pnpm --filter @gitinspect/app dev >"$server_log" 2>&1 &
  started_server_pid=$!
  server_mode='gate-owned-repo-vite'
  server_deadline=$(( $(date +%s) + 20 ))
  until validate_server; do
    if ! kill -0 "$started_server_pid" 2>/dev/null; then
      write_environment_blocker "gate-owned Vite server exited before native fixture became ready; log=$(tail -n 8 "$server_log" | tr '\n' ' ')"
    fi
    (( $(date +%s) < server_deadline )) \
      || write_environment_blocker 'gate-owned Vite server did not expose the native smoke fixture within 20 seconds'
    sleep 0.1
  done
fi

native_manifest='apps/gitinspect/src-tauri/Cargo.toml'
printf 'native_gate_build_started_at=%s\n' "$(now_iso)"
cargo build --manifest-path "$native_manifest" --bin mutation_preview_native_smoke
native_binary="$repo_root/apps/gitinspect/src-tauri/target/debug/mutation_preview_native_smoke"
[[ -x "$native_binary" ]] || write_environment_blocker "native smoke binary missing after build: $native_binary"

native_binary_sha=$(sha256sum "$native_binary" | awk '{print $1}')
native_rust_sha=$(sha256sum apps/gitinspect/src-tauri/src/bin/mutation_preview_native_smoke.rs | awk '{print $1}')
native_ts_sha=$(sha256sum apps/gitinspect/src/mutationPreviewNativeSmoke.tsx | awk '{print $1}')
gate_sha=$(sha256sum scripts/native-release-qualification.sh | awk '{print $1}')
head=$(git rev-parse HEAD)
recorded_at=$(now_iso)

printf 'NATIVE_RELEASE_QUALIFICATION=START\n'
printf 'recorded_at=%s\n' "$recorded_at"
printf 'head=%s\n' "$head"
printf 'original_workspace=%s\n' "$original_workspace"
printf 'controlled_workspace=%s\n' "$controlled_workspace"
printf 'server_mode=%s\n' "$server_mode"
printf 'native_binary_sha256=%s\n' "$native_binary_sha"
printf 'native_rust_sha256=%s\n' "$native_rust_sha"
printf 'native_ts_sha256=%s\n' "$native_ts_sha"
printf 'gate_sha256=%s\n' "$gate_sha"
printf 'focus_policy=one external wmctrl handoff only after exact WebGL convergence marker; no refocus loop/click/hidden helper/success delay\n'

i3-msg workspace "$controlled_workspace" >/dev/null
switched_workspace=1
[[ "$(focused_workspace)" == "$controlled_workspace" ]] \
  || write_environment_blocker "i3 did not focus controlled workspace '$controlled_workspace'"
[[ "$(workspace_window_count "$controlled_workspace")" == '0' ]] \
  || write_environment_blocker "controlled workspace '$controlled_workspace' acquired an unrelated window before qualification"
[[ "$(active_window_id)" == '0x0' ]] \
  || write_environment_blocker "controlled workspace '$controlled_workspace' did not begin with _NET_ACTIVE_WINDOW=0x0"

monitor_active_windows() {
  local transitions=$1 target_file=$2 handoff_file=$3 alive_file=$4
  local previous='__unset__' current target='' workspace class title handoff='' phase='pre-handoff'
  while [[ -e "$alive_file" ]]; do
    if [[ -s "$target_file" ]]; then
      target=$(cat "$target_file")
      if [[ -s "$handoff_file" ]]; then
        handoff=$(cat "$handoff_file")
      fi
      if [[ -n "$handoff" ]] && ! xprop -id "$target" WM_CLASS >/dev/null 2>&1; then
        break
      fi
    fi
    current=$(active_window_id)
    if [[ "$current" != "$previous" ]]; then
      phase='pre-handoff'
      [[ -s "$handoff_file" ]] && phase='post-handoff'
      workspace=''
      class=''
      title=''
      if [[ "$current" != '0x0' ]]; then
        workspace=$(window_workspace "$current" 2>/dev/null || true)
        class=$(window_class "$current" 2>/dev/null || true)
        title=$(window_title "$current" 2>/dev/null || true)
      fi
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(now_ms)" "$current" "$workspace" "$class" "$title" "$phase" >>"$transitions"
      previous=$current
    fi
    sleep 0.02
  done
}

run_json_files=()
overall_pass=1

for ((run=1; run<=runs; run+=1)); do
  printf '\n=== native decisive run %d/%d ===\n' "$run" "$runs"

  pre_native=$(native_smoke_process_count)
  pre_other=$(other_headed_runner_count)
  pre_workspace_windows=$(workspace_window_count "$controlled_workspace")
  pre_active=$(active_window_id)
  printf 'preflight_native_smoke_processes=%s\n' "$pre_native"
  printf 'preflight_other_gitinspect_headed_runners=%s\n' "$pre_other"
  printf 'preflight_workspace_windows=%s\n' "$pre_workspace_windows"
  printf 'preflight_active_window=%s\n' "$pre_active"

  if ((pre_native != 0 || pre_other != 0)) || ((pre_workspace_windows != 0)) || [[ "$pre_active" != '0x0' ]]; then
    write_environment_blocker "run $run preflight lost isolated authority: native=$pre_native other=$pre_other workspace_windows=$pre_workspace_windows active=$pre_active"
  fi

  before_clients="$runtime_dir/run-$run-before-clients.txt"
  raw_output="$runtime_dir/run-$run-raw.txt"
  source_result='apps/gitinspect/src-tauri/target/mutation-preview-native-smoke/last-result.txt'
  transitions="$runtime_dir/run-$run-active-window.tsv"
  target_file="$runtime_dir/run-$run-target-window.txt"
  handoff_file="$runtime_dir/run-$run-handoff-ms.txt"
  alive_file="$runtime_dir/run-$run-alive"
  result_copy="$runtime_dir/run-$run-result.txt"
  run_json="$runtime_dir/run-$run.json"
  : >"$transitions"
  : >"$target_file"
  : >"$handoff_file"
  touch "$alive_file"
  client_window_ids >"$before_clients"
  rm -f "$source_result"

  monitor_active_windows "$transitions" "$target_file" "$handoff_file" "$alive_file" &
  monitor_pid=$!
  active_monitor_pid=$monitor_pid
  active_alive_file=$alive_file

  run_started_at=$(now_iso)
  "$native_binary" >"$raw_output" 2>&1 &
  run_pid=$!
  active_run_pid=$run_pid
  launched_exe=$(readlink -f "/proc/$run_pid/exe" 2>/dev/null || true)
  if [[ "$launched_exe" != "$native_binary" || "${launched_exe##*/}" != "$EXPECTED_CLASS" ]]; then
    kill "$run_pid" 2>/dev/null || true
    wait "$run_pid" 2>/dev/null || true
    rm -f "$alive_file"
    wait "$monitor_pid" 2>/dev/null || true
    write_environment_blocker "run $run launch provenance mismatch: pid=$run_pid exe=${launched_exe:-unknown} expected=$native_binary"
  fi
  printf 'run_pid=%s\n' "$run_pid"
  printf 'run_executable=%s\n' "$launched_exe"
  printf 'run_started_at=%s\n' "$run_started_at"

  discovery_deadline=$(( $(date +%s) + 45 ))
  target_window=''
  ready_seen=0
  while kill -0 "$run_pid" 2>/dev/null; do
    new_matching=()
    while read -r id; do
      [[ -n "$id" ]] || continue
      grep -qx "$id" "$before_clients" && continue
      class=$(window_class "$id" 2>/dev/null || true)
      title=$(window_title "$id" 2>/dev/null || true)
      if wm_class_matches_expected "$class" && [[ "$title" == "$EXPECTED_TITLE" ]]; then
        new_matching+=("$id")
      fi
    done < <(client_window_ids)

    if ((${#new_matching[@]} > 1)); then
      rm -f "$alive_file"
      wait "$monitor_pid" 2>/dev/null || true
      kill "$run_pid" 2>/dev/null || true
      wait "$run_pid" 2>/dev/null || true
      write_environment_blocker "run $run discovered multiple newly-created native smoke windows: ${new_matching[*]}"
    fi
    if ((${#new_matching[@]} == 1)); then
      target_window=${new_matching[0]}
      printf '%s' "$target_window" >"$target_file"
    fi

    if grep -Fq "$READY_MARKER" "$raw_output"; then
      ready_seen=1
      break
    fi
    if (( $(date +%s) >= discovery_deadline )); then
      break
    fi
    sleep 0.02
  done

  if ((ready_seen == 0)) || [[ -z "$target_window" ]]; then
    set +e
    wait "$run_pid"
    native_exit=$?
    set -e
    rm -f "$alive_file"
    wait "$monitor_pid" 2>/dev/null || true
    printf '%s\n' "--- raw native output ---"
    cat "$raw_output"
    write_environment_blocker "run $run failed before exact readiness/new-window handoff (ready=$ready_seen target=${target_window:-none} native_exit=$native_exit)"
  fi

  current_runners=$(headed_runner_processes)
  current_native=$(printf '%s\n' "$current_runners" | awk -F '\t' '$2 == "mutation_preview_native_smoke" {count += 1} END {print count + 0}')
  current_other=$(printf '%s\n' "$current_runners" | awk -F '\t' 'NF && $2 != "mutation_preview_native_smoke" {count += 1} END {print count + 0}')
  if ((current_native != 1 || current_other != 0)); then
    kill "$run_pid" 2>/dev/null || true
    wait "$run_pid" 2>/dev/null || true
    rm -f "$alive_file"
    wait "$monitor_pid" 2>/dev/null || true
    runners=$(printf '%s\n' "$current_runners" | tr '\n' ';')
    write_environment_blocker "run $run competing headed runner at handoff: native=$current_native other=$current_other processes=$runners"
  fi

  target_workspace=$(window_workspace "$target_window")
  target_class=$(window_class "$target_window")
  target_title=$(window_title "$target_window")
  [[ "$target_workspace" == "$controlled_workspace" ]] \
    || write_environment_blocker "run $run new Tauri window landed on workspace '$target_workspace', expected '$controlled_workspace'"
  wm_class_matches_expected "$target_class" \
    || write_environment_blocker "run $run new Tauri window WM_CLASS mismatch: $target_class"
  [[ "$target_title" == "$EXPECTED_TITLE" ]] \
    || write_environment_blocker "run $run new Tauri window title mismatch: $target_title"

  readiness_at=$(now_iso)
  active_before=$(active_window_id)
  handoff_ms=$(now_ms)
  printf '%s' "$handoff_ms" >"$handoff_file"
  wmctrl -ia "$target_window"
  handoff_at=$(now_iso)
  active_after=$(active_window_id)
  [[ "$active_after" == "$target_window" ]] \
    || write_environment_blocker "run $run exact one-time handoff did not establish native active-window authority (target=$target_window active_after=$active_after)"

  printf 'new_tauri_window_id=%s\n' "$target_window"
  printf 'workspace_identity=%s\n' "$target_workspace"
  printf 'wm_class=%s\n' "$target_class"
  printf 'window_title=%s\n' "$target_title"
  printf 'webgl_convergence_ready_at=%s\n' "$readiness_at"
  printf 'handoff_at=%s\n' "$handoff_at"
  printf 'handoff_count=1\n'
  printf 'active_before_handoff=%s\n' "$active_before"
  printf 'active_after_handoff=%s\n' "$active_after"

  set +e
  wait "$run_pid"
  native_exit=$?
  set -e
  native_exit_at=$(now_iso)
  rm -f "$alive_file"
  active_alive_file=''
  wait "$monitor_pid" 2>/dev/null || true
  active_monitor_pid=''
  active_run_pid=''

  if [[ -f "$source_result" ]]; then
    cp "$source_result" "$result_copy"
  else
    printf 'MUTATION_PREVIEW_NATIVE_SMOKE=FAIL\nmessage=missing last-result.txt\n' >"$result_copy"
  fi

  raw_sha=$(sha256sum "$raw_output" | awk '{print $1}')
  transition_sha=$(sha256sum "$transitions" | awk '{print $1}')
  result_sha=$(sha256sum "$result_copy" | awk '{print $1}')

  smoke_status=$(field_value "$result_copy" MUTATION_PREVIEW_NATIVE_SMOKE)
  frame_samples=$(field_value "$result_copy" frame_samples)
  frame_visibility_state=$(field_value "$result_copy" frame_visibility_state)
  frame_document_has_focus=$(field_value "$result_copy" frame_document_has_focus)
  frame_visibility_changes=$(field_value "$result_copy" frame_visibility_changes)
  frame_window_focus_events=$(field_value "$result_copy" frame_window_focus_events)
  frame_window_blur_events=$(field_value "$result_copy" frame_window_blur_events)
  frame_max_gap_visibility_state=$(field_value "$result_copy" frame_max_gap_visibility_state)
  frame_max_gap_document_has_focus=$(field_value "$result_copy" frame_max_gap_document_has_focus)
  frame_accessibility_live=$(field_value "$result_copy" frame_accessibility_live)
  frame_accessibility_pressed=$(field_value "$result_copy" frame_accessibility_pressed)
  frame_accessibility_roving=$(field_value "$result_copy" frame_accessibility_roving)
  frame_accessibility_element_id=$(field_value "$result_copy" frame_accessibility_element_id)
  frame_accessibility_blocker=$(field_value "$result_copy" frame_accessibility_blocker)
  frame_accessibility_visibility_state=$(field_value "$result_copy" frame_accessibility_visibility_state)
  frame_accessibility_document_has_focus=$(field_value "$result_copy" frame_accessibility_document_has_focus)
  frame_accessibility_focus_stable=$(field_value "$result_copy" frame_accessibility_focus_stable)
  frame_timing_blocker=$(field_value "$result_copy" frame_timing_blocker)
  failures=$(field_value "$result_copy" failures)
  apply_disabled=$(field_value "$result_copy" apply_disabled)
  frame_renderer=$(field_value "$result_copy" frame_renderer)

  unrelated_after_handoff=$(awk -F '\t' -v target="$target_window" '
    $6 == "post-handoff" && $2 != target && $2 != "0x0" {print; count += 1}
    END {if (count == 0) exit 0; else exit 1}
  ' "$transitions" 2>/dev/null || true)
  unrelated_transition_count=$(awk -F '\t' -v target="$target_window" '
    $6 == "post-handoff" && $2 != target && $2 != "0x0" {count += 1} END {print count + 0}
  ' "$transitions")
  transitions_json=$(jq -Rn '
    [inputs
      | split("\t")
      | {
          timestampMs: (.[0] | tonumber),
          activeWindow: .[1],
          workspace: .[2],
          wmClass: .[3],
          title: .[4],
          phase: .[5]
        }]
  ' <"$transitions")

  blockers=()
  ((native_exit == 0)) || blockers+=("native_exit=$native_exit")
  [[ "$smoke_status" == 'PASS' ]] || blockers+=("smoke_status=${smoke_status:-missing}")
  [[ "$frame_samples" =~ ^[0-9]+$ ]] && ((frame_samples >= 120)) || blockers+=("frame_samples=${frame_samples:-missing}")
  [[ "$frame_visibility_state" == 'visible' ]] || blockers+=("frame_visibility_state=${frame_visibility_state:-missing}")
  [[ "$frame_document_has_focus" == 'true' ]] || blockers+=("frame_document_has_focus=${frame_document_has_focus:-missing}")
  [[ "$frame_visibility_changes" == '0' ]] || blockers+=("frame_visibility_changes=${frame_visibility_changes:-missing}")
  [[ "$frame_window_focus_events" == '0' ]] || blockers+=("frame_window_focus_events=${frame_window_focus_events:-missing}")
  [[ "$frame_window_blur_events" == '0' ]] || blockers+=("frame_window_blur_events=${frame_window_blur_events:-missing}")
  [[ "$frame_max_gap_visibility_state" == 'visible' ]] || blockers+=("frame_max_gap_visibility_state=${frame_max_gap_visibility_state:-missing}")
  [[ "$frame_max_gap_document_has_focus" == 'true' ]] || blockers+=("frame_max_gap_document_has_focus=${frame_max_gap_document_has_focus:-missing}")
  [[ "$frame_timing_blocker" == '' ]] || blockers+=("frame_timing_blocker=$frame_timing_blocker")
  [[ "$frame_accessibility_live" == 'true' ]] || blockers+=("frame_accessibility_live=${frame_accessibility_live:-missing}")
  [[ "$frame_accessibility_pressed" == 'true' ]] || blockers+=("frame_accessibility_pressed=${frame_accessibility_pressed:-missing}")
  [[ "$frame_accessibility_roving" == 'true' ]] || blockers+=("frame_accessibility_roving=${frame_accessibility_roving:-missing}")
  [[ "$frame_accessibility_element_id" == "$EXPECTED_SELECTED_ID" ]] || blockers+=("frame_accessibility_element_id=${frame_accessibility_element_id:-missing}")
  [[ "$frame_accessibility_blocker" == '' ]] || blockers+=("frame_accessibility_blocker=$frame_accessibility_blocker")
  [[ "$frame_accessibility_visibility_state" == 'visible' ]] || blockers+=("frame_accessibility_visibility_state=${frame_accessibility_visibility_state:-missing}")
  [[ "$frame_accessibility_document_has_focus" == 'true' ]] || blockers+=("frame_accessibility_document_has_focus=${frame_accessibility_document_has_focus:-missing}")
  [[ "$frame_accessibility_focus_stable" == 'true' ]] || blockers+=("frame_accessibility_focus_stable=${frame_accessibility_focus_stable:-missing}")
  [[ "$failures" == '' ]] || blockers+=("harness_failures=$failures")
  [[ "$apply_disabled" == 'true' ]] || blockers+=("apply_disabled=${apply_disabled:-missing}")
  ((unrelated_transition_count == 0)) || blockers+=("unrelated_active_window_transitions_after_handoff=$unrelated_transition_count")

  if ((${#blockers[@]} == 0)); then
    run_pass=true
  else
    run_pass=false
    overall_pass=0
  fi

  printf 'native_exit=%s\n' "$native_exit"
  printf 'native_exit_at=%s\n' "$native_exit_at"
  printf 'frame_renderer=%s\n' "$frame_renderer"
  printf 'frame_samples=%s\n' "$frame_samples"
  printf 'frame_visibility_state=%s\n' "$frame_visibility_state"
  printf 'frame_document_has_focus=%s\n' "$frame_document_has_focus"
  printf 'frame_visibility_changes=%s\n' "$frame_visibility_changes"
  printf 'frame_window_focus_events=%s\n' "$frame_window_focus_events"
  printf 'frame_window_blur_events=%s\n' "$frame_window_blur_events"
  printf 'frame_accessibility_live=%s\n' "$frame_accessibility_live"
  printf 'frame_accessibility_pressed=%s\n' "$frame_accessibility_pressed"
  printf 'frame_accessibility_roving=%s\n' "$frame_accessibility_roving"
  printf 'frame_accessibility_element_id=%s\n' "$frame_accessibility_element_id"
  printf 'frame_accessibility_blocker=%s\n' "$frame_accessibility_blocker"
  printf 'unrelated_active_window_transitions_after_handoff=%s\n' "$unrelated_transition_count"
  printf 'raw_sha256=%s\n' "$raw_sha"
  printf 'active_window_transitions_sha256=%s\n' "$transition_sha"
  printf 'native_result_sha256=%s\n' "$result_sha"
  printf 'run_pass=%s\n' "$run_pass"
  if ((${#blockers[@]} > 0)); then
    printf 'run_blockers=%s\n' "$(IFS=' | '; echo "${blockers[*]}")"
  else
    printf 'run_blockers=\n'
  fi
  printf '%s\n' '--- active-window transitions ---'
  cat "$transitions"
  if [[ -n "$unrelated_after_handoff" ]]; then
    printf '%s\n' '--- unrelated transitions after handoff ---'
    printf '%s\n' "$unrelated_after_handoff"
  fi
  printf '%s\n' '--- strict native result ---'
  cat "$result_copy"

  blockers_json=$(printf '%s\n' "${blockers[@]:-}" | jq -Rsc 'split("\n") | map(select(length > 0))')
  jq -n \
    --argjson run "$run" \
    --arg startedAt "$run_started_at" \
    --arg readinessAt "$readiness_at" \
    --arg handoffAt "$handoff_at" \
    --arg exitedAt "$native_exit_at" \
    --arg workspace "$controlled_workspace" \
    --arg windowId "$target_window" \
    --arg wmClass "$target_class" \
    --arg title "$target_title" \
    --arg activeBefore "$active_before" \
    --arg activeAfter "$active_after" \
    --argjson nativeExit "$native_exit" \
    --argjson runPid "$run_pid" \
    --arg runExecutable "$launched_exe" \
    --argjson preflightNative "$pre_native" \
    --argjson preflightOther "$pre_other" \
    --argjson handoffNative "$current_native" \
    --argjson handoffOther "$current_other" \
    --arg renderer "$frame_renderer" \
    --argjson frameSamples "${frame_samples:-0}" \
    --arg visibility "$frame_visibility_state" \
    --argjson documentHasFocus "${frame_document_has_focus:-false}" \
    --argjson visibilityChanges "${frame_visibility_changes:-999}" \
    --argjson windowFocusEvents "${frame_window_focus_events:-999}" \
    --argjson windowBlurEvents "${frame_window_blur_events:-999}" \
    --arg selectedId "$frame_accessibility_element_id" \
    --argjson live "${frame_accessibility_live:-false}" \
    --argjson pressed "${frame_accessibility_pressed:-false}" \
    --argjson roving "${frame_accessibility_roving:-false}" \
    --arg accessibilityBlocker "$frame_accessibility_blocker" \
    --arg timingBlocker "$frame_timing_blocker" \
    --argjson focusStable "${frame_accessibility_focus_stable:-false}" \
    --argjson unrelatedTransitions "$unrelated_transition_count" \
    --argjson activeWindowTransitions "$transitions_json" \
    --arg rawSha256 "$raw_sha" \
    --arg transitionsSha256 "$transition_sha" \
    --arg resultSha256 "$result_sha" \
    --argjson passed "$run_pass" \
    --argjson blockers "$blockers_json" \
    '{
      run:$run,startedAt:$startedAt,readinessAt:$readinessAt,handoffAt:$handoffAt,exitedAt:$exitedAt,
      workspace:$workspace,window:{id:$windowId,wmClass:$wmClass,title:$title},
      processes:{runPid:$runPid,runExecutable:$runExecutable,
        preflightNativeSmoke:$preflightNative,preflightOtherHeadedGitinspect:$preflightOther,
        handoffNativeSmoke:$handoffNative,handoffOtherHeadedGitinspect:$handoffOther},
      handoff:{count:1,activeBefore:$activeBefore,activeAfter:$activeAfter},nativeExit:$nativeExit,
      activeWindowTransitions:$activeWindowTransitions,
      frame:{renderer:$renderer,samples:$frameSamples,visibilityState:$visibility,documentHasFocus:$documentHasFocus,
        visibilityChanges:$visibilityChanges,windowFocusEvents:$windowFocusEvents,windowBlurEvents:$windowBlurEvents,
        timingBlocker:$timingBlocker},
      accessibility:{selectedSemanticId:$selectedId,live:$live,pressed:$pressed,exactlyOneRovingTabStop:$roving,
        blocker:$accessibilityBlocker,focusStable:$focusStable},
      unrelatedActiveWindowTransitionsAfterHandoff:$unrelatedTransitions,
      evidence:{rawSha256:$rawSha256,activeWindowTransitionsSha256:$transitionsSha256,nativeResultSha256:$resultSha256},
      passed:$passed,blockers:$blockers
    }' >"$run_json"
  run_json_files+=("$run_json")

  post_native=$(native_smoke_process_count)
  post_other=$(other_headed_runner_count)
  post_workspace_windows=$(workspace_window_count "$controlled_workspace")
  post_active=$(active_window_id)
  if ((post_native != 0 || post_other != 0 || post_workspace_windows != 0)) || [[ "$post_active" != '0x0' ]]; then
    write_environment_blocker "run $run cleanup did not return to isolated empty workspace: native=$post_native other=$post_other workspace_windows=$post_workspace_windows active=$post_active"
  fi
done

runs_json=$(jq -s '.' "${run_json_files[@]}")
status='PASS'
if ((overall_pass == 0)); then
  status='FAIL'
fi

jq -n \
  --argjson schemaVersion 1 \
  --arg status "$status" \
  --arg recordedAt "$recorded_at" \
  --arg head "$head" \
  --arg originalWorkspace "$original_workspace" \
  --arg controlledWorkspace "$controlled_workspace" \
  --arg serverMode "$server_mode" \
  --arg readinessMarker "$READY_MARKER" \
  --arg gateSha256 "$gate_sha" \
  --arg nativeBinarySha256 "$native_binary_sha" \
  --arg nativeRustSha256 "$native_rust_sha" \
  --arg nativeTsSha256 "$native_ts_sha" \
  --argjson runs "$runs_json" \
  '{
    schemaVersion:$schemaVersion,status:$status,recordedAt:$recordedAt,head:$head,
    desktop:{originalWorkspace:$originalWorkspace,controlledWorkspace:$controlledWorkspace,serverMode:$serverMode},
    contract:{minimumSerializedRuns:3,readinessMarker:$readinessMarker,maxExternalHandoffsPerRun:1,
      noContinuousRefocus:true,noSyntheticClicks:true,noHiddenHelperWindows:true,nativeFpsAuthority:true,
      browserSupplementalOnly:true,browserNativeFpsClaim:false},
    sourceEvidence:{gateSha256:$gateSha256,nativeBinarySha256:$nativeBinarySha256,
      nativeRustSha256:$nativeRustSha256,nativeTsSha256:$nativeTsSha256},
    runs:$runs
  }' >"$summary_path"

summary_sha=$(sha256sum "$summary_path" | awk '{print $1}')
printf '\nNATIVE_RELEASE_QUALIFICATION=%s\n' "$status"
printf 'serialized_green_runs=%s/%s\n' "$(jq '[.runs[] | select(.passed == true)] | length' "$summary_path")" "$runs"
printf 'summary=%s\n' "$summary_path"
printf 'summary_sha256=%s\n' "$summary_sha"

if [[ "$status" != 'PASS' ]]; then
  exit 1
fi
