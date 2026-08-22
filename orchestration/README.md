# Orchestration

Phase-3 worker prompts live in `orchestration/prompts/`. They are intentionally path-isolated. Workers must coordinate through ws-bridge presence/notes and must not edit `CHANGELOG.md`; they report proposed changelog bullets to the architect instead.

All workers use `/home/user/code/gitinspect`, `run_workspace_command`, the `prolong` protocol, local commits only, and repository-local temporary directories.
