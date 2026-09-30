# GitInspect plugins

GitInspect 0.3 introduces a sandboxed plugin API for repository metrics and findings. The extension format is deliberately declarative: third-party plugins are JSON data interpreted by `gitinspect-core`; GitInspect does not load native libraries, JavaScript, WebAssembly, shell commands, or other executable plugin code.

## Security boundary

Plugin evaluation is read-only and bounded.

- Declarative manifests live under `.gitinspect/plugins/`.
- Auto-discovery considers regular `.json` files only.
- Explicit manifest paths from `.gitinspect.yml` must canonicalize inside `.gitinspect/plugins/`.
- Manifest symlinks are rejected.
- A manifest is capped at 256 KiB and its schema rejects unknown fields.
- Working-tree traversal does not follow symlinks and skips `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.next`, and `.cache`.
- Repository, file, history, diff, finding, and content-scan limits are host-controlled. Configuration cannot widen them.
- Bare repositories expose commit/ref data but no working-tree file scan.
- Plugin messages support literal placeholders only; no template expressions or evaluation are performed.

The plugin API is therefore an analysis DSL, not a general-purpose program runtime.

## Configuration

GitInspect looks for `.gitinspect.yml` at the repository root. Version 1 intentionally accepts a small YAML mapping subset: two-space indentation, scalar values, and full-line comments. YAML anchors, tags, sequences, nested arbitrary objects, and executable hooks are not part of the contract.

```yaml
version: 1
plugins:
  security-audit:
    enabled: true
  license-check:
    enabled: true
    require-license-file: true
  dependency-freshness:
    enabled: true
    max-age-days: 180
  repository-policy:
    enabled: true
    manifest: .gitinspect/plugins/repository-policy.json
```

Built-ins are enabled by default when no configuration file exists. A declarative manifest in `.gitinspect/plugins/*.json` is auto-discovered and enabled by default unless its matching configuration entry sets `enabled: false`.

## Built-in plugins

### security-audit

Performs an offline, bounded audit of repository metadata and small text files. It reports active Git hooks, unencrypted `http://` remote URLs, credential/key-looking paths, and a small set of high-confidence credential markers. It does not contact a breach service, execute hooks, or attempt to validate credentials.

### license-check

Looks for `LICENSE` / `COPYING` files and obvious license declarations in supported package manifests. `require-license-file: false` suppresses the dedicated missing-license-file finding, while the plugin still reports its metrics.

### dependency-freshness

Reports dependency-manifest freshness from the bounded Git history. `max-age-days` defaults to 180 and is limited to 1–3650 days.

This is intentionally an offline repository-history heuristic. Version 1 does **not** claim that a dependency version is the newest version published to npm, crates.io, PyPI, or another registry. When the bounded history does not reveal the last manifest change, the result is informational and freshness is reported as unknown.

Recognized manifests include package manager files for Node.js, Rust, Python, Go, and Ruby.

## Declarative plugin manifest

A manifest has `schemaVersion: 1`, an identifier, a name, and 1–200 rules.

```json
{
  "schemaVersion": 1,
  "id": "repository-policy",
  "name": "Repository policy",
  "description": "Example organization-local metrics and findings.",
  "rules": [
    {
      "id": "todo-commit",
      "source": "commit",
      "field": "message",
      "operator": "contains",
      "value": "TODO",
      "severity": "warning",
      "message": "Commit {commit} still contains TODO in its message",
      "metric": "todoCommits"
    },
    {
      "id": "large-file",
      "source": "file",
      "field": "sizeBytes",
      "operator": "gt",
      "value": 1048576,
      "severity": "info",
      "message": "Large working-tree file: {path}",
      "metric": "largeFiles"
    }
  ]
}
```

Every rule produces a match-count metric. `metric` overrides the metric name; otherwise GitInspect uses `rule.<id>.matches`. Each matched rule may also produce a bounded finding.

### Sources and fields

| source | fields |
| --- | --- |
| `repository` | `revision`, `head`, `headRef`, `hook`, `remoteUrl` |
| `commit` | `message`, `authorName`, `signatureStatus`, `parentCount`, `authoredAtMs`, `committedAtMs` |
| `file` | `path`, `extension`, `sizeBytes` |
| `diff` | `path`, `status`, `kind`, `additions`, `deletions` |

The `diff` source exposes the bounded per-commit file-change records that GitInspect already derives from Git history. It does not hand a plugin an unrestricted patch/blob reader.

Supported operators are `equals`, `contains`, `prefix`, `suffix`, `gt`, `gte`, `lt`, and `lte`. String comparisons are ASCII case-insensitive by default; set `caseSensitive: true` when needed. Numeric operators require numeric fields and numeric values.

Messages may contain `{value}`, `{path}`, and `{commit}`; they are replaced literally from the matched record.

## Report integration

The native command `run_repository_plugins` evaluates plugins against the currently opened repository revision. A revision mismatch fails closed rather than attaching stale findings to a newer repository view.

The React inspector shows a repository-level plugin summary. When an inspection JSON export is created after analysis is ready, it includes the exact already-loaded `pluginReport` alongside the selected element/diff/file detail. Exporting does not cause a second plugin run or broaden repository authority.

The serialized v1 report contains:

```text
schemaVersion, apiVersion, repositoryRevision, configPath?
plugins[]:
  id, name, source, status, findings[], metrics[], truncated
summary:
  enabledPlugins, disabledPlugins, infoFindings, warningFindings, errorFindings
diagnostics[]
truncated
```

`truncated: true` means one or more host bounds prevented complete enumeration. Consumers should not interpret a truncated clean result as proof that no finding exists.
