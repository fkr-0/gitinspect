#!/usr/bin/env python3
"""Optional Linux pidfd exact-identity helper contract and owned-fixture diagnostics.

This file is deliberately not wired into the production native release gate.  Its CLI
only runs diagnostics; callers that eventually reuse signal_exact_identity must supply
one exact snapshotted (pid, /proc start-time) identity per call.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable


class Result(str, Enum):
    SIGNALED = "SIGNALED"
    PREOPEN_IDENTITY_MISMATCH = "PREOPEN_IDENTITY_MISMATCH"
    POSTOPEN_IDENTITY_MISMATCH = "POSTOPEN_IDENTITY_MISMATCH"
    VANISHED = "VANISHED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    NOT_AVAILABLE = "NOT_AVAILABLE"


@dataclass(frozen=True)
class ProcessSnapshot:
    pid: int
    start_time: int


ReadStart = Callable[[int], int]
OpenPidfd = Callable[[int, int], int]
SendPidfdSignal = Callable[[int, int, object | None, int], None]
CloseFd = Callable[[int], None]


def parse_proc_stat_start_time(data: str) -> int:
    """Return Linux /proc/<pid>/stat field 22, tolerating hostile comm text.

    Field 2 is parenthesized but the command name itself may contain spaces and right
    parentheses.  The delimiter that matters is therefore the *last* ')' before field
    3, not a naive split on the first parenthesis.
    """

    close = data.rfind(")")
    if close < 0 or close + 2 > len(data) or data[close + 1 : close + 2] != " ":
        raise ValueError("proc-stat-comm-delimiter-missing")
    tail = data[close + 2 :].split()
    # tail[0] is field 3 (state), so field 22 is tail[19].
    if len(tail) < 20:
        raise ValueError("proc-stat-truncated")
    try:
        return int(tail[19])
    except ValueError as exc:
        raise ValueError("proc-stat-start-time-invalid") from exc


def proc_start_time(pid: int, proc_root: Path = Path("/proc")) -> int:
    data = (proc_root / str(pid) / "stat").read_text(encoding="utf-8")
    return parse_proc_stat_start_time(data)


def _map_read_error(exc: OSError) -> Result:
    if isinstance(exc, FileNotFoundError) or exc.errno in {errno.ENOENT, errno.ESRCH}:
        return Result.VANISHED
    if isinstance(exc, PermissionError) or exc.errno in {errno.EACCES, errno.EPERM}:
        return Result.PERMISSION_DENIED
    raise exc


def _map_pidfd_error(exc: OSError) -> Result:
    if exc.errno in {errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL}:
        return Result.NOT_AVAILABLE
    return _map_read_error(exc)


def signal_exact_identity(
    snapshot: ProcessSnapshot,
    sig: int,
    *,
    read_start: ReadStart = proc_start_time,
    open_pidfd: OpenPidfd | None = getattr(os, "pidfd_open", None),
    send_pidfd_signal: SendPidfdSignal | None = getattr(signal, "pidfd_send_signal", None),
    close_fd: CloseFd = os.close,
) -> Result:
    """Signal one exact snapshotted identity, once, without PID-only fallback.

    Safety order is fixed and intentionally has no retry loop:
      snapshot PID/start-time -> pre-open match -> pidfd_open -> post-open match ->
      pidfd-targeted signal.
    """

    if open_pidfd is None or send_pidfd_signal is None:
        return Result.NOT_AVAILABLE

    try:
        pre_start = read_start(snapshot.pid)
    except OSError as exc:
        return _map_read_error(exc)
    if pre_start != snapshot.start_time:
        return Result.PREOPEN_IDENTITY_MISMATCH

    try:
        fd = open_pidfd(snapshot.pid, 0)
    except OSError as exc:
        return _map_pidfd_error(exc)

    try:
        try:
            post_start = read_start(snapshot.pid)
        except OSError as exc:
            return _map_read_error(exc)
        if post_start != snapshot.start_time:
            return Result.POSTOPEN_IDENTITY_MISMATCH

        try:
            send_pidfd_signal(fd, sig, None, 0)
        except OSError as exc:
            return _map_pidfd_error(exc)
        return Result.SIGNALED
    finally:
        close_fd(fd)


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _synthetic_proc_stat(start_time: int, comm: str = "hostile ) name (( with spaces") -> str:
    # Fields after comm: 3=state, then 4..22.  The final value is field 22.
    fields_4_to_21 = [str(index) for index in range(4, 22)]
    return f"4242 ({comm}) S {' '.join(fields_4_to_21)} {start_time}\n"


def _run_contract_unit_diagnostics() -> None:
    hostile_start = 987654321
    _assert(parse_proc_stat_start_time(_synthetic_proc_stat(hostile_start)) == hostile_start, "hostile-proc-stat-parser")

    calls: list[str] = []

    def unopened_pidfd(_pid: int, _flags: int) -> int:
        calls.append("open")
        return 91

    def unexpected_signal(_fd: int, _sig: int, _info: object | None, _flags: int) -> None:
        calls.append("signal")

    stale = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: 701,
        open_pidfd=unopened_pidfd,
        send_pidfd_signal=unexpected_signal,
        close_fd=lambda _fd: calls.append("close"),
    )
    _assert(stale is Result.PREOPEN_IDENTITY_MISMATCH and calls == [], "preopen-mismatch-signalled")

    reads = iter((700, 701))
    post_calls: list[str] = []
    post = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: next(reads),
        open_pidfd=lambda _pid, _flags: (post_calls.append("open") or 92),
        send_pidfd_signal=lambda *_args: post_calls.append("signal"),
        close_fd=lambda _fd: post_calls.append("close"),
    )
    _assert(post is Result.POSTOPEN_IDENTITY_MISMATCH and post_calls == ["open", "close"], "postopen-mismatch-signalled")

    vanished_calls: list[str] = []
    vanished = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: (_ for _ in ()).throw(FileNotFoundError(errno.ENOENT, "gone")),
        open_pidfd=lambda _pid, _flags: (vanished_calls.append("open") or 93),
        send_pidfd_signal=lambda *_args: vanished_calls.append("signal"),
        close_fd=lambda _fd: vanished_calls.append("close"),
    )
    _assert(vanished is Result.VANISHED and vanished_calls == [], "vanished-pid-opened")

    denied_calls: list[str] = []
    denied = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: (_ for _ in ()).throw(PermissionError(errno.EACCES, "denied")),
        open_pidfd=lambda _pid, _flags: (denied_calls.append("open") or 94),
        send_pidfd_signal=lambda *_args: denied_calls.append("signal"),
        close_fd=lambda _fd: denied_calls.append("close"),
    )
    _assert(denied is Result.PERMISSION_DENIED and denied_calls == [], "permission-path-opened")

    unsupported = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: 700,
        open_pidfd=lambda _pid, _flags: (_ for _ in ()).throw(OSError(errno.ENOSYS, "unsupported")),
        send_pidfd_signal=unexpected_signal,
    )
    _assert(unsupported is Result.NOT_AVAILABLE, "unsupported-api-not-reported")

    unavailable = signal_exact_identity(
        ProcessSnapshot(123, 700),
        signal.SIGTERM,
        read_start=lambda _pid: 700,
        open_pidfd=None,
        send_pidfd_signal=None,
    )
    _assert(unavailable is Result.NOT_AVAILABLE, "missing-api-not-reported")


def _spawn_hostile_comm_child() -> subprocess.Popen[bytes]:
    program = r'''
import ctypes
import sys
import time
libc = ctypes.CDLL(None, use_errno=True)
PR_SET_NAME = 15
name = b"hostile ) ((pid"
if libc.prctl(PR_SET_NAME, ctypes.c_char_p(name), 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "prctl(PR_SET_NAME)")
sys.stdout.buffer.write(b"ready\n")
sys.stdout.buffer.flush()
time.sleep(30)
'''
    child = subprocess.Popen([sys.executable, "-c", program], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert child.stdout is not None
    ready = child.stdout.readline()
    if ready != b"ready\n":
        stderr = b"" if child.stderr is None else child.stderr.read()
        child.kill()
        child.wait()
        raise RuntimeError(f"hostile-child-start-failed:{stderr.decode('utf-8', errors='replace')}")
    return child


def _terminate_owned(child: subprocess.Popen[bytes]) -> None:
    if child.poll() is None:
        child.kill()
        child.wait(timeout=5)


def _run_live_owned_diagnostics() -> tuple[int, bool]:
    child = _spawn_hostile_comm_child()
    try:
        snapshot = ProcessSnapshot(child.pid, proc_start_time(child.pid))
        result = signal_exact_identity(snapshot, signal.SIGTERM)
        _assert(result is Result.SIGNALED, f"owned-child-result-{result.value}")
        exit_code = child.wait(timeout=5)
        _assert(exit_code == -signal.SIGTERM, f"owned-child-exit-{exit_code}")
    finally:
        _terminate_owned(child)

    vanished_child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    vanished_snapshot = ProcessSnapshot(vanished_child.pid, proc_start_time(vanished_child.pid))
    vanished_child.terminate()
    vanished_child.wait(timeout=5)
    vanished_result = signal_exact_identity(vanished_snapshot, signal.SIGTERM)
    _assert(vanished_result is Result.VANISHED, f"vanished-owned-result-{vanished_result.value}")

    reuse_child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    fd = os.pidfd_open(reuse_child.pid, 0)  # type: ignore[attr-defined]
    try:
        signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)  # type: ignore[attr-defined]
        reuse_child.wait(timeout=5)
        try:
            signal.pidfd_send_signal(fd, 0, None, 0)  # type: ignore[attr-defined]
        except ProcessLookupError:
            reuse_safe = True
        except OSError as exc:
            reuse_safe = exc.errno == errno.ESRCH
        else:
            reuse_safe = False
    finally:
        _terminate_owned(reuse_child)
        os.close(fd)
    _assert(reuse_safe, "exited-pidfd-retargeted")
    return exit_code, reuse_safe


def run_self_test() -> int:
    if not sys.platform.startswith("linux"):
        print(f"PIDFD_HELPER_DIAGNOSTICS=NOT_APPLICABLE platform={sys.platform} generic_requirement=false")
        return 0
    if os.environ.get("GITINSPECT_PIDFD_FORCE_API_UNAVAILABLE") == "1":
        print("PIDFD_HELPER_DIAGNOSTICS=NOT_AVAILABLE platform=Linux reason=python-api-unavailable generic_requirement=false")
        return 0
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        print("PIDFD_HELPER_DIAGNOSTICS=NOT_AVAILABLE platform=Linux reason=python-api-unavailable generic_requirement=false")
        return 0

    try:
        _run_contract_unit_diagnostics()
    except (RuntimeError, ValueError) as exc:
        print(f"PIDFD_HELPER_DIAGNOSTICS=FAIL reason=contract-self-test detail={exc!s}", file=sys.stderr)
        return 1

    try:
        exit_code, reuse_safe = _run_live_owned_diagnostics()
    except OSError as exc:
        print(
            "PIDFD_HELPER_DIAGNOSTICS=NOT_AVAILABLE "
            f"platform=Linux reason={type(exc).__name__} generic_requirement=false detail={exc!s}",
        )
        return 0
    except (RuntimeError, subprocess.TimeoutExpired, ValueError) as exc:
        print(f"PIDFD_HELPER_DIAGNOSTICS=FAIL reason=owned-fixture-self-test detail={exc!s}", file=sys.stderr)
        return 1

    print(
        "pidfd_helper_contract=PASS sequence=snapshot-preopen-pidfd-open-postopen-fd-signal "
        "one_call_per_identity=true hostile_proc_stat=true vanished_pid=true permission_fail_closed=true "
        "unsupported_api_fail_closed=true"
    )
    print(
        f"pidfd_owned_fixture=PASS fd_targeted_signal=true child_exit={exit_code} "
        f"exited_pidfd_retarget={str(not reuse_safe).lower()}"
    )
    print("PIDFD_HELPER_DIAGNOSTICS=PASS platform=Linux generic_requirement=false production_gate_integration=false")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optional pidfd exact-identity diagnostics; never production signalling CLI")
    parser.add_argument("--self-test", action="store_true", help="run owned-fixture contract diagnostics")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.self_test:
        print("refusing operational pid signalling: this Phase-49 helper exposes diagnostics only", file=sys.stderr)
        return 64
    return run_self_test()


if __name__ == "__main__":
    raise SystemExit(main())
