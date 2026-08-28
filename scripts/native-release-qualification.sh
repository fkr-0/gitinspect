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

native_lane_platform_result() {
  if [[ ${1:-} == 'Linux' ]]; then
    printf '%s\n' 'APPLICABLE'
  else
    printf '%s\n' 'NOT_APPLICABLE'
  fi
}

classify_headed_runner() {
  (($# >= 2)) || return 1
  local real_executable=$1
  local argv0=$2
  shift 2
  local real_base=${real_executable##*/}
  local argv0_base=${argv0##*/}
  local arg name i

  case "$real_base" in
    mutation_preview_native_smoke|native_visual_smoke|native_bridge_smoke|gitinspect)
      printf '%s\n' "$real_base"
      return 0
      ;;
    node|nodejs)
      for arg in "$@"; do
        if [[ "${arg##*/}" == 'mutation-preview-headed-webgl.mjs' ]]; then
          printf '%s\n' 'browser-headed-webgl'
          return 0
        fi
      done
      return 1
      ;;
    cargo)
      ;;
    rustup)
      # On rustup-managed hosts /usr/bin/cargo resolves to the rustup proxy.
      # Accept that proxy only when the process was actually invoked as cargo;
      # an arbitrary process with cargo-shaped argv must not become a blocker.
      [[ "$argv0_base" == 'cargo' ]] || return 1
      ;;
    *)
      return 1
      ;;
  esac

  # Preserve argv boundaries and require `run` to be the actual Cargo
  # subcommand. A later positional `run` (for example a test filter) must not
  # turn another Cargo command into a competing headed launcher. Support only
  # the bounded leading global/proxy options that can legitimately precede a
  # Cargo subcommand; unknown pre-subcommand tokens fail closed.
  local -a args=("$@")
  local run_index=-1
  for ((i=0; i<${#args[@]}; i+=1)); do
    case "${args[i]}" in
      run)
        run_index=$i
        break
        ;;
      -v|--verbose|-q|--quiet|--frozen|--locked|--offline|+*)
        ;;
      --color|--config|-Z)
        ((i + 1 < ${#args[@]})) || return 1
        i=$((i + 1))
        ;;
      --color=*|--config=*|-Z?*)
        ;;
      *)
        return 1
        ;;
    esac
  done
  ((run_index >= 0)) || return 1
  for ((i=run_index + 1; i<${#args[@]}; i+=1)); do
    [[ "${args[i]}" == '--' ]] && break
    name=''
    if [[ "${args[i]}" == '--bin' ]] && ((i + 1 < ${#args[@]})); then
      name=${args[i + 1]}
    elif [[ "${args[i]}" == --bin=* ]]; then
      name=${args[i]#--bin=}
    fi
    case "$name" in
      mutation_preview_native_smoke)
        printf '%s\n' 'cargo-mutation-preview-native-smoke'
        return 0
        ;;
      native_visual_smoke)
        printf '%s\n' 'cargo-native-visual-smoke'
        return 0
        ;;
      native_bridge_smoke)
        printf '%s\n' 'cargo-native-bridge-smoke'
        return 0
        ;;
    esac
  done
  return 1
}

headed_runner_record_for_pid() {
  local pid=$1 real_executable argv0 kind argv_display arg
  local -a argv=()
  real_executable=$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)
  [[ -n "$real_executable" ]] || return 1
  while IFS= read -r -d '' arg; do
    argv+=("$arg")
  done <"/proc/$pid/cmdline" 2>/dev/null || true
  ((${#argv[@]} > 0)) || return 1
  argv0=${argv[0]}
  kind=$(classify_headed_runner "$real_executable" "$argv0" "${argv[@]:1}" 2>/dev/null || true)
  [[ -n "$kind" ]] || return 1
  printf -v argv_display '%q ' "${argv[@]}"
  printf '%s\t%s\t%s exe=%s argv=%s\n' "$pid" "$kind" "$pid" "$real_executable" "${argv_display% }"
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
    local expected=$1 real_executable=$2 argv0=$3
    shift 3
    actual=$(classify_headed_runner "$real_executable" "$argv0" "$@" 2>/dev/null || true)
    if [[ "$actual" != "$expected" ]]; then
      printf 'self_test_failure=runner expected=%s actual=%s real_executable=%s argv0=%s\n' "$expected" "$actual" "$real_executable" "$argv0" >&2
      failures=$((failures + 1))
    fi
  }

  assert_no_runner() {
    local real_executable=$1 argv0=$2
    shift 2
    actual=$(classify_headed_runner "$real_executable" "$argv0" "$@" 2>/dev/null || true)
    if [[ -n "$actual" ]]; then
      printf 'self_test_failure=false-positive runner=%s real_executable=%s argv0=%s\n' "$actual" "$real_executable" "$argv0" >&2
      failures=$((failures + 1))
    fi
  }

  assert_runner mutation_preview_native_smoke /repo/target/debug/mutation_preview_native_smoke /repo/target/debug/mutation_preview_native_smoke
  assert_runner gitinspect /usr/bin/gitinspect /usr/bin/gitinspect
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/cargo /usr/bin/cargo run --manifest-path app/Cargo.toml --bin mutation_preview_native_smoke
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/rustup /usr/bin/cargo run --bin=mutation_preview_native_smoke
  assert_runner cargo-native-visual-smoke /usr/bin/rustup cargo run --bin native_visual_smoke
  assert_runner cargo-native-bridge-smoke /usr/bin/cargo cargo run --bin native_bridge_smoke
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/cargo cargo --locked run --bin mutation_preview_native_smoke
  assert_runner cargo-mutation-preview-native-smoke /usr/bin/rustup cargo +stable run --bin=mutation_preview_native_smoke
  assert_runner browser-headed-webgl /usr/local/bin/node /usr/local/bin/node /repo/scripts/mutation-preview-headed-webgl.mjs --headed
  assert_runner browser-headed-webgl /usr/bin/nodejs nodejs /repo/scripts/mutation-preview-headed-webgl.mjs --headed
  assert_no_runner /usr/bin/cargo cargo run --bin mutation_preview_native_smoke_extra
  assert_no_runner /usr/bin/cargo cargo run '--bin mutation_preview_native_smoke'
  assert_no_runner /usr/bin/cargo cargo test --bin mutation_preview_native_smoke
  assert_no_runner /usr/bin/cargo cargo build --bin=mutation_preview_native_smoke
  assert_no_runner /usr/bin/cargo cargo test run --bin mutation_preview_native_smoke
  assert_no_runner /usr/bin/cargo cargo build run --bin=mutation_preview_native_smoke
  assert_no_runner /usr/bin/cargo cargo run -- --bin mutation_preview_native_smoke
  assert_no_runner /usr/bin/cargo cargo '--manifest-path app/Cargo.toml run --bin mutation_preview_native_smoke'
  assert_no_runner /usr/bin/node node /repo/scripts/mutation-preview-headed-webgl.mjs.backup
  assert_no_runner /usr/bin/node node '/repo/scripts/not-the-runner mutation-preview-headed-webgl.mjs'
  assert_no_runner /usr/bin/bash bash -c 'echo mutation_preview_native_smoke'
  assert_no_runner /usr/bin/sleep /repo/target/debug/mutation_preview_native_smoke 30
  assert_no_runner /usr/bin/python3.14 cargo -c 'import time; time.sleep(30)' --bin=mutation_preview_native_smoke
  assert_no_runner /usr/bin/python3.14 node -c 'import time; time.sleep(30)' /repo/scripts/mutation-preview-headed-webgl.mjs
  assert_no_runner /usr/bin/rustup rustup run stable cargo run --bin mutation_preview_native_smoke

  # Exercise the production /proc provenance seam, not only the pure classifier:
  # argv[0] is deliberately spoofed as the native smoke binary while the actual
  # executable remains /usr/bin/sleep. This must not become a competing runner.
  local spoof_pid spoof_record=''
  bash -c 'exec -a mutation_preview_native_smoke sleep 5' &
  spoof_pid=$!
  sleep 0.05
  spoof_record=$(headed_runner_record_for_pid "$spoof_pid" 2>/dev/null || true)
  kill "$spoof_pid" 2>/dev/null || true
  wait "$spoof_pid" 2>/dev/null || true
  if [[ -n "$spoof_record" ]]; then
    printf 'self_test_failure=argv0-spoof false-positive record=%s\n' "$spoof_record" >&2
    failures=$((failures + 1))
  fi

  # Preserve real argv boundaries through the production /proc reader. `ps args`
  # would flatten this one embedded-space argument and manufacture a false exact
  # browser-script token; the NUL-delimited cmdline reader must reject it.
  if command -v node >/dev/null 2>&1; then
    local node_pid node_record=''
    node -e 'setTimeout(() => {}, 5000)' '/repo/not-the-runner mutation-preview-headed-webgl.mjs' &
    node_pid=$!
    sleep 0.05
    node_record=$(headed_runner_record_for_pid "$node_pid" 2>/dev/null || true)
    kill "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
    if [[ -n "$node_record" ]]; then
      printf 'self_test_failure=embedded-space-node-argv false-positive record=%s\n' "$node_record" >&2
      failures=$((failures + 1))
    fi
  fi

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

  [[ "$(native_lane_platform_result Linux)" == 'APPLICABLE' ]] || {
    echo 'self_test_failure=linux native lane applicability misclassified' >&2
    failures=$((failures + 1))
  }
  [[ "$(native_lane_platform_result Darwin)" == 'NOT_APPLICABLE' ]] || {
    echo 'self_test_failure=darwin native lane applicability misclassified' >&2
    failures=$((failures + 1))
  }
  [[ "$(native_lane_platform_result Windows_NT)" == 'NOT_APPLICABLE' ]] || {
    echo 'self_test_failure=windows native lane applicability misclassified' >&2
    failures=$((failures + 1))
  }

  if ! run_cleanup_ownership_self_test; then
    failures=$((failures + 1))
  fi

  local no_display_summary="$runtime_dir/no-display-applicability.json"
  local no_display_output="$runtime_dir/no-display-applicability.txt"
  local no_display_exit=0
  set +e
  env -u DISPLAY -u I3SOCK bash "$repo_root/scripts/native-release-qualification.sh" \
    --summary "$no_display_summary" >"$no_display_output" 2>&1
  no_display_exit=$?
  set -e
  if [[ "$no_display_exit" != '2' ]] \
    || ! jq -e '
      .status == "BLOCKED_ENVIRONMENT"
      and .nativeApplicability.lane == "linux-x11-i3"
      and .nativeApplicability.result == "PREREQUISITE_UNAVAILABLE"
      and (.environmentBlocker | contains("DISPLAY is unset"))
      and (.runs | length == 0)
    ' "$no_display_summary" >/dev/null 2>&1; then
    printf 'self_test_failure=no-display-applicability exit=%s output=%s\n' \
      "$no_display_exit" "$(tr '\n' ';' <"$no_display_output")" >&2
    failures=$((failures + 1))
  else
    printf 'native_applicability_self_test=PASS lane=linux-x11-i3 result=PREREQUISITE_UNAVAILABLE exit=2\n'
  fi

  local unsupported_bin="$runtime_dir/unsupported-platform-bin"
  local unsupported_summary="$runtime_dir/unsupported-platform-applicability.json"
  local unsupported_output="$runtime_dir/unsupported-platform-applicability.txt"
  local unsupported_exit=0
  mkdir -p "$unsupported_bin"
  printf '%s\n' '#!/bin/sh' 'printf "Darwin\\n"' >"$unsupported_bin/uname"
  chmod +x "$unsupported_bin/uname"
  set +e
  PATH="$unsupported_bin:$PATH" bash "$repo_root/scripts/native-release-qualification.sh" \
    --summary "$unsupported_summary" >"$unsupported_output" 2>&1
  unsupported_exit=$?
  set -e
  if [[ "$unsupported_exit" != '2' ]] \
    || ! grep -qx 'native_applicability=NOT_APPLICABLE' "$unsupported_output" \
    || ! jq -e '
      .status == "BLOCKED_ENVIRONMENT"
      and .nativeApplicability.lane == "linux-x11-i3"
      and .nativeApplicability.result == "NOT_APPLICABLE"
      and (.environmentBlocker | contains("not applicable on platform"))
      and (.environmentBlocker | contains("Darwin"))
      and (.runs | length == 0)
    ' "$unsupported_summary" >/dev/null 2>&1; then
    printf 'self_test_failure=unsupported-platform-applicability exit=%s output=%s\n' \
      "$unsupported_exit" "$(tr '\n' ';' <"$unsupported_output")" >&2
    failures=$((failures + 1))
  else
    printf 'native_applicability_self_test=PASS lane=linux-x11-i3 result=NOT_APPLICABLE simulated_platform=Darwin exit=2\n'
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
  --self-test       Run pure provenance, cleanup-ownership, and applicability regressions.
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
self_test_listener_pid=''
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
  local pid
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    headed_runner_record_for_pid "$pid" 2>/dev/null || true
  done < <(ps -e -o pid=)
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

proc_start_time() {
  local pid=$1 stat tail
  [[ "$pid" =~ ^[0-9]+$ ]] && [[ -r "/proc/$pid/stat" ]] || return 1
  stat=$(<"/proc/$pid/stat")
  tail=${stat#*) }
  awk '{print $20}' <<<"$tail"
}

process_identity_token() {
  local pid=$1 start
  start=$(proc_start_time "$pid" 2>/dev/null || true)
  [[ -n "$start" ]] || return 1
  printf '%s:%s\n' "$pid" "$start"
}

process_identity_matches() {
  local pid=$1 expected_start=$2 actual_start
  actual_start=$(proc_start_time "$pid" 2>/dev/null || true)
  [[ -n "$actual_start" && "$actual_start" == "$expected_start" ]]
}

collect_owned_process_tree_pids() {
  local root=$1 child
  while read -r child; do
    [[ -n "$child" ]] || continue
    collect_owned_process_tree_pids "$child"
  done < <(ps -e -o pid=,ppid= | awk -v parent="$root" '$2 == parent {print $1}')
  printf '%s\n' "$root"
}

process_tree_identity_csv() {
  local root=$1 pid token csv=''
  while read -r pid; do
    token=$(process_identity_token "$pid" 2>/dev/null || true)
    [[ -n "$token" ]] || continue
    [[ -z "$csv" ]] || csv+=','
    csv+="$token"
  done < <(collect_owned_process_tree_pids "$root")
  printf '%s\n' "$csv"
}

identity_csv_is_gone() {
  local csv=$1 token pid start
  local -a tokens=()
  [[ -n "$csv" ]] || return 1
  IFS=',' read -r -a tokens <<<"$csv"
  for token in "${tokens[@]}"; do
    pid=${token%%:*}
    start=${token#*:}
    if process_identity_matches "$pid" "$start"; then
      return 1
    fi
  done
  return 0
}

terminate_owned_process_tree() {
  local root=${1:-} pgid='' pid any i
  local -a pids=() starts=()
  [[ "$root" =~ ^[0-9]+$ ]] || return 0
  [[ "$root" != "$$" ]] || return 1
  [[ -r "/proc/$root/stat" ]] || return 0

  mapfile -t pids < <(collect_owned_process_tree_pids "$root")
  ((${#pids[@]} > 0)) || return 0
  for pid in "${pids[@]}"; do
    starts+=("$(proc_start_time "$pid" 2>/dev/null || true)")
  done

  pgid=$(ps -o pgid= -p "$root" 2>/dev/null | tr -d ' ' || true)
  if [[ "$pgid" == "$root" ]]; then
    kill -TERM -- "-$root" 2>/dev/null || true
  else
    for ((i=0; i<${#pids[@]}; i+=1)); do
      [[ -n "${starts[i]}" ]] || continue
      if process_identity_matches "${pids[i]}" "${starts[i]}"; then
        kill -TERM "${pids[i]}" 2>/dev/null || true
      fi
    done
  fi

  for _ in {1..40}; do
    any=0
    for ((i=0; i<${#pids[@]}; i+=1)); do
      [[ -n "${starts[i]}" ]] || continue
      if process_identity_matches "${pids[i]}" "${starts[i]}"; then
        any=1
        break
      fi
    done
    ((any == 0)) && break
    sleep 0.05
  done

  any=0
  for ((i=0; i<${#pids[@]}; i+=1)); do
    [[ -n "${starts[i]}" ]] || continue
    if process_identity_matches "${pids[i]}" "${starts[i]}"; then
      any=1
      if [[ "$pgid" != "$root" ]]; then
        kill -KILL "${pids[i]}" 2>/dev/null || true
      fi
    fi
  done
  if ((any != 0)) && [[ "$pgid" == "$root" ]]; then
    kill -KILL -- "-$root" 2>/dev/null || true
  fi
  wait "$root" 2>/dev/null || true
}

wait_for_nonempty_file() {
  local file=$1
  for _ in {1..100}; do
    [[ -s "$file" ]] && return 0
    sleep 0.05
  done
  return 1
}

write_loopback_server_fixture() {
  local destination=$1
  cat >"$destination" <<'NODE'
const fs = require('node:fs');
const http = require('node:http');

const [portFile, body] = process.argv.slice(2);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end(body);
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port));
});
NODE
}

run_cleanup_fixture_child() {
  local ready_file=${GITINSPECT_NATIVE_CLEANUP_SELF_TEST_READY_FILE:-}
  local signal_file=${GITINSPECT_NATIVE_CLEANUP_SELF_TEST_SIGNAL_FILE:-}
  local server_script="$runtime_dir/loopback-server.js"
  local server_port_file="$runtime_dir/server-port.txt"
  local requested_signal=''
  [[ -n "$ready_file" && -n "$signal_file" ]] || return 64
  command -v node >/dev/null 2>&1 || return 69

  write_loopback_server_fixture "$server_script"
  active_alive_file="$runtime_dir/monitor-alive"
  touch "$active_alive_file"

  bash -c 'sleep 300 & wait "$!"' &
  active_run_pid=$!
  bash -c 'sleep 300 & wait "$!"' &
  active_monitor_pid=$!
  # The positional parameters are intentionally expanded by the child shell.
  # shellcheck disable=SC2016
  setsid bash -c 'node "$1" "$2" gate-owned-server & wait "$!"' _ \
    "$server_script" "$server_port_file" &
  started_server_pid=$!

  wait_for_nonempty_file "$server_port_file" || return 70
  sleep 0.05
  local ready_tmp="${ready_file}.tmp.$$"
  {
    printf 'runtime_dir=%s\n' "$runtime_dir"
    printf 'native_identities=%s\n' "$(process_tree_identity_csv "$active_run_pid")"
    printf 'monitor_identities=%s\n' "$(process_tree_identity_csv "$active_monitor_pid")"
    printf 'server_identities=%s\n' "$(process_tree_identity_csv "$started_server_pid")"
    printf 'server_port=%s\n' "$(cat "$server_port_file")"
  } >"$ready_tmp"
  mv "$ready_tmp" "$ready_file"

  while [[ ! -s "$signal_file" ]]; do
    sleep 0.02
  done
  requested_signal=$(cat "$signal_file")
  case "$requested_signal" in
    INT|TERM)
      kill -s "$requested_signal" "$$"
      ;;
    *)
      return 64
      ;;
  esac
  sleep 1
  return 70
}

run_cleanup_ownership_case() {
  local signal=$1 expected_exit=$2 failures=0
  local case_dir="$runtime_dir/cleanup-self-test-${signal,,}"
  local unrelated_script="$case_dir/unrelated-server.js"
  local unrelated_port_file="$case_dir/unrelated-port.txt"
  local ready_file="$case_dir/child-ready.txt"
  local signal_file="$case_dir/child-signal.txt"
  local child_pid_file="$case_dir/child-pid.txt"
  local child_log="$case_dir/child.log"
  local launcher_pid child_pid child_exit=0 unrelated_port unrelated_identity unrelated_start
  local unrelated_exe unrelated_cmdline_sha runtime_owned server_port
  local native_identities monitor_identities server_identities
  mkdir -p "$case_dir"
  write_loopback_server_fixture "$unrelated_script"

  setsid node "$unrelated_script" "$unrelated_port_file" unrelated-preexisting-listener &
  self_test_listener_pid=$!
  wait_for_nonempty_file "$unrelated_port_file" || {
    echo "cleanup_self_test_failure=$signal unrelated listener did not bind" >&2
    return 1
  }
  unrelated_port=$(cat "$unrelated_port_file")
  unrelated_identity=$(process_identity_token "$self_test_listener_pid")
  unrelated_start=${unrelated_identity#*:}
  unrelated_exe=$(readlink -f "/proc/$self_test_listener_pid/exe")
  unrelated_cmdline_sha=$(sha256sum "/proc/$self_test_listener_pid/cmdline" | awk '{print $1}')
  [[ "$(curl -fsS --max-time 2 "http://127.0.0.1:$unrelated_port/")" == 'unrelated-preexisting-listener' ]] || {
    echo "cleanup_self_test_failure=$signal unrelated listener not reachable before child" >&2
    failures=$((failures + 1))
  }

  GITINSPECT_NATIVE_CLEANUP_SELF_TEST_CHILD=1 \
    GITINSPECT_NATIVE_CLEANUP_SELF_TEST_READY_FILE="$ready_file" \
    GITINSPECT_NATIVE_CLEANUP_SELF_TEST_SIGNAL_FILE="$signal_file" \
    python3 -c '
import signal
import subprocess
import sys

pid_file, script = sys.argv[1:3]

def reset_signals():
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)

process = subprocess.Popen(["bash", script], preexec_fn=reset_signals)
with open(pid_file, "w", encoding="utf-8") as handle:
    handle.write(str(process.pid))
sys.exit(process.wait())
' "$child_pid_file" "$repo_root/scripts/native-release-qualification.sh" >"$child_log" 2>&1 &
  launcher_pid=$!

  if ! wait_for_nonempty_file "$ready_file" || ! wait_for_nonempty_file "$child_pid_file"; then
    echo "cleanup_self_test_failure=$signal child did not become ready" >&2
    terminate_owned_process_tree "$launcher_pid"
    failures=$((failures + 1))
  else
    child_pid=$(cat "$child_pid_file")
    runtime_owned=$(field_value "$ready_file" runtime_dir)
    native_identities=$(field_value "$ready_file" native_identities)
    monitor_identities=$(field_value "$ready_file" monitor_identities)
    server_identities=$(field_value "$ready_file" server_identities)
    server_port=$(field_value "$ready_file" server_port)
    printf '%s\n' "$signal" >"$signal_file"
    set +e
    wait "$launcher_pid"
    child_exit=$?
    set -e

    [[ "$child_exit" == "$expected_exit" ]] || {
      printf 'cleanup_self_test_failure=%s expected_exit=%s actual_exit=%s child_pid=%s log=%s\n' \
        "$signal" "$expected_exit" "$child_exit" "$child_pid" "$(tr '\n' ';' <"$child_log")" >&2
      failures=$((failures + 1))
    }
    [[ ! -e "$runtime_owned" ]] || {
      echo "cleanup_self_test_failure=$signal runtime residue=$runtime_owned" >&2
      failures=$((failures + 1))
    }
    identity_csv_is_gone "$native_identities" || {
      echo "cleanup_self_test_failure=$signal native descendant residue=$native_identities" >&2
      failures=$((failures + 1))
    }
    identity_csv_is_gone "$monitor_identities" || {
      echo "cleanup_self_test_failure=$signal monitor descendant residue=$monitor_identities" >&2
      failures=$((failures + 1))
    }
    identity_csv_is_gone "$server_identities" || {
      echo "cleanup_self_test_failure=$signal server descendant residue=$server_identities" >&2
      failures=$((failures + 1))
    }
    if ss -ltnp "( sport = :$server_port )" 2>/dev/null | grep -q 'pid='; then
      echo "cleanup_self_test_failure=$signal gate-owned server listener survived port=$server_port" >&2
      failures=$((failures + 1))
    fi
    if ! process_identity_matches "$self_test_listener_pid" "$unrelated_start" \
      || [[ "$(readlink -f "/proc/$self_test_listener_pid/exe" 2>/dev/null || true)" != "$unrelated_exe" ]] \
      || [[ "$(sha256sum "/proc/$self_test_listener_pid/cmdline" 2>/dev/null | awk '{print $1}')" != "$unrelated_cmdline_sha" ]] \
      || [[ "$(curl -fsS --max-time 2 "http://127.0.0.1:$unrelated_port/" 2>/dev/null || true)" != 'unrelated-preexisting-listener' ]]; then
      echo "cleanup_self_test_failure=$signal unrelated listener changed or disappeared" >&2
      failures=$((failures + 1))
    fi
    if ((failures == 0)); then
      printf 'cleanup_signal=%s cleanup_exit=%s child_pid=%s native_tree_gone=true monitor_tree_gone=true server_tree_gone=true runtime_removed=true unrelated_listener_preserved=true\n' \
        "$signal" "$child_exit" "$child_pid"
    fi
  fi

  terminate_owned_process_tree "$self_test_listener_pid"
  self_test_listener_pid=''
  return "$failures"
}

run_cleanup_ownership_self_test() {
  local failures=0
  command -v node >/dev/null 2>&1 || {
    echo 'cleanup_self_test_failure=node unavailable' >&2
    return 1
  }
  command -v python3 >/dev/null 2>&1 || {
    echo 'cleanup_self_test_failure=python3 unavailable' >&2
    return 1
  }
  run_cleanup_ownership_case TERM 143 || failures=$((failures + 1))
  run_cleanup_ownership_case INT 130 || failures=$((failures + 1))
  if ((failures != 0)); then
    printf 'NATIVE_RELEASE_QUALIFICATION_CLEANUP_SELF_TEST=FAIL failures=%d\n' "$failures" >&2
    return 1
  fi
  echo 'NATIVE_RELEASE_QUALIFICATION_CLEANUP_SELF_TEST=PASS'
}

cleanup() {
  if ((cleanup_complete)); then
    return
  fi
  cleanup_complete=1

  terminate_owned_process_tree "$active_run_pid"
  if [[ -n "$active_alive_file" ]]; then
    rm -f "$active_alive_file"
  fi
  terminate_owned_process_tree "$active_monitor_pid"
  terminate_owned_process_tree "$started_server_pid"

  if ((switched_workspace)) && [[ -n "$original_workspace" ]]; then
    i3-msg workspace "$original_workspace" >/dev/null 2>&1 || true
  fi

  terminate_owned_process_tree "$self_test_listener_pid"
  self_test_listener_pid=''
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

if [[ ${GITINSPECT_NATIVE_CLEANUP_SELF_TEST_CHILD:-0} == '1' ]]; then
  run_cleanup_fixture_child
  exit $?
fi

if ((self_test)); then
  run_self_test
  exit $?
fi

[[ "$runs" =~ ^[0-9]+$ ]] || { echo '--runs must be an integer' >&2; exit 64; }
((runs >= REQUIRED_RUNS)) || {
  echo "--runs may not weaken native acceptance below $REQUIRED_RUNS" >&2
  exit 64
}

write_environment_blocker() {
  local blocker=$1
  local applicability=${2:-APPLICABLE_BLOCKED_ENVIRONMENT}
  local recorded_at
  # Applicability can be decided before GNU/Linux-specific tools exist. Keep
  # this timestamp portable across BSD/macOS date and common Windows shells.
  recorded_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '%s' unknown)
  printf 'NATIVE_RELEASE_QUALIFICATION=BLOCKED_ENVIRONMENT\n'
  printf 'native_lane=linux-x11-i3\n'
  printf 'native_applicability=%s\n' "$applicability"
  printf 'environment_blocker=%s\n' "$blocker"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg status 'BLOCKED_ENVIRONMENT' \
      --arg blocker "$blocker" \
      --arg lane 'linux-x11-i3' \
      --arg applicability "$applicability" \
      --arg recordedAt "$recorded_at" \
      --arg head "$(git rev-parse HEAD)" \
      '{schemaVersion:1,status:$status,environmentBlocker:$blocker,recordedAt:$recordedAt,head:$head,
        nativeApplicability:{lane:$lane,result:$applicability},runs:[]}' \
      >"$summary_path"
    printf 'summary=%s\n' "$summary_path"
  else
    printf 'summary_unavailable=jq is unavailable\n'
  fi
  exit 2
}

platform_name=$(uname -s 2>/dev/null || printf '%s' unknown)
if [[ "$(native_lane_platform_result "$platform_name")" != 'APPLICABLE' ]]; then
  write_environment_blocker \
    "native Linux/X11/i3 qualification is not applicable on platform '$platform_name'; use the generic release:verify gate for platform-independent regression checks" \
    'NOT_APPLICABLE'
fi

for tool in awk bash cargo curl date grep i3-msg jq pnpm ps readlink sed setsid sha256sum sort ss tr uname wmctrl xprop; do
  command -v "$tool" >/dev/null || write_environment_blocker "required tool unavailable: $tool"
done

[[ -n "${DISPLAY:-}" ]] || write_environment_blocker 'DISPLAY is unset; X11 native qualification is unavailable' 'PREREQUISITE_UNAVAILABLE'
i3-msg -t get_version >/dev/null 2>&1 || write_environment_blocker 'i3 IPC is unavailable on the active X11 session' 'PREREQUISITE_UNAVAILABLE'
xprop -root _NET_ACTIVE_WINDOW >/dev/null 2>&1 || write_environment_blocker 'X11 root-window focus authority is unavailable' 'PREREQUISITE_UNAVAILABLE'

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
    nativeApplicability:{lane:"linux-x11-i3",result:"APPLICABLE"},
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
