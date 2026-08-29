#!/usr/bin/env bash
set -euo pipefail

# Optional Phase-49-only diagnostics. This wrapper deliberately remains outside
# scripts/native-release-qualification.sh and therefore cannot become a generic
# release prerequisite merely because Python or pidfd support is absent.

script_dir=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
platform=${GITINSPECT_PIDFD_FORCE_PLATFORM:-$(uname -s 2>/dev/null || printf unknown)}

if [[ "$platform" != 'Linux' ]]; then
  printf 'PIDFD_HELPER_DIAGNOSTICS=NOT_APPLICABLE platform=%s generic_requirement=false production_gate_integration=false\n' "$platform"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo 'PIDFD_HELPER_DIAGNOSTICS=NOT_AVAILABLE platform=Linux reason=python3-unavailable generic_requirement=false production_gate_integration=false'
  exit 0
fi

exec python3 "$script_dir/native-release-pidfd-helper.py" --self-test
