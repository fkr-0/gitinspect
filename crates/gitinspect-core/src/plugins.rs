use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::{DiffOptions, GitCommitRecord, GitRepositorySnapshot, OpenOptions, RepositoryHandle};

pub const PLUGIN_API_VERSION: u8 = 1;
pub const PLUGIN_REPORT_SCHEMA_VERSION: u8 = 1;

const CONFIG_FILE: &str = ".gitinspect.yml";
const PLUGIN_DIR: &str = ".gitinspect/plugins";
const DEFAULT_MAX_COMMITS: usize = 128;
const DEFAULT_MAX_FILES: usize = 5_000;
const DEFAULT_MAX_FILE_BYTES: u64 = 64 * 1024;
const DEFAULT_MAX_TOTAL_CONTENT_BYTES: u64 = 8 * 1024 * 1024;
const DEFAULT_MAX_FINDINGS_PER_PLUGIN: usize = 200;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRunOptions {
    pub max_commits: usize,
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_content_bytes: u64,
    pub max_findings_per_plugin: usize,
}

impl Default for PluginRunOptions {
    fn default() -> Self {
        Self {
            max_commits: DEFAULT_MAX_COMMITS,
            max_files: DEFAULT_MAX_FILES,
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_total_content_bytes: DEFAULT_MAX_TOTAL_CONTENT_BYTES,
            max_findings_per_plugin: DEFAULT_MAX_FINDINGS_PER_PLUGIN,
        }
    }
}

impl PluginRunOptions {
    pub fn bounded(self) -> Self {
        let defaults = Self::default();
        Self {
            max_commits: self.max_commits.clamp(1, defaults.max_commits),
            max_files: self.max_files.clamp(1, defaults.max_files),
            max_file_bytes: self.max_file_bytes.clamp(1, defaults.max_file_bytes),
            max_total_content_bytes: self
                .max_total_content_bytes
                .clamp(1, defaults.max_total_content_bytes),
            max_findings_per_plugin: self
                .max_findings_per_plugin
                .clamp(1, defaults.max_findings_per_plugin),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PluginSeverity {
    Info,
    #[default]
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginStatus {
    Passed,
    Warning,
    Failed,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginSource {
    Builtin,
    Manifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFinding {
    pub rule_id: String,
    pub severity: PluginSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMetric {
    pub name: String,
    pub value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginResult {
    pub id: String,
    pub name: String,
    pub source: PluginSource,
    pub status: PluginStatus,
    pub findings: Vec<PluginFinding>,
    pub metrics: Vec<PluginMetric>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginReportSummary {
    pub enabled_plugins: usize,
    pub disabled_plugins: usize,
    pub info_findings: usize,
    pub warning_findings: usize,
    pub error_findings: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReport {
    pub schema_version: u8,
    pub api_version: u8,
    pub repository_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    pub plugins: Vec<PluginResult>,
    pub summary: PluginReportSummary,
    pub diagnostics: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("repository plugin analysis failed: {0}")]
    Repository(#[from] crate::repository::Error),
    #[error("plugin filesystem operation failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid plugin configuration: {0}")]
    Config(String),
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub rules: Vec<PluginRule>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginRuleSource {
    Repository,
    Commit,
    File,
    Diff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginRuleOperator {
    Equals,
    Contains,
    Prefix,
    Suffix,
    Gt,
    Gte,
    Lt,
    Lte,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRule {
    pub id: String,
    pub source: PluginRuleSource,
    pub field: String,
    pub operator: PluginRuleOperator,
    pub value: Value,
    #[serde(default)]
    pub severity: PluginSeverity,
    pub message: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub metric: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct PluginConfig {
    entries: BTreeMap<String, PluginConfigEntry>,
}

#[derive(Debug, Clone)]
struct PluginConfigEntry {
    enabled: bool,
    manifest: Option<String>,
    settings: BTreeMap<String, String>,
}

impl Default for PluginConfigEntry {
    fn default() -> Self {
        Self {
            enabled: true,
            manifest: None,
            settings: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct FileRecord {
    path: String,
    size_bytes: u64,
    content: Option<String>,
}

#[derive(Debug, Clone)]
struct RuleCandidate {
    value: Value,
    path: Option<String>,
    commit_oid: Option<String>,
}

impl RepositoryHandle {
    pub fn run_plugins(&self, options: PluginRunOptions) -> Result<PluginReport, PluginError> {
        let options = options.bounded();
        let snapshot = self.refresh(OpenOptions {
            max_commits: options.max_commits,
            include_commit_files: true,
            diff: DiffOptions {
                max_files: options.max_files,
                ..DiffOptions::default()
            },
        })?;
        run_plugins_for_snapshot(self.repository_path(), &snapshot, &options, None)
    }
}

fn run_plugins_for_snapshot(
    repository_root: &Path,
    snapshot: &GitRepositorySnapshot,
    options: &PluginRunOptions,
    now_ms: Option<i64>,
) -> Result<PluginReport, PluginError> {
    let config_path = repository_root.join(CONFIG_FILE);
    let (config, config_present, mut diagnostics) = if config_path.is_file() {
        let text = fs::read_to_string(&config_path).map_err(|source| PluginError::Io {
            path: config_path.clone(),
            source,
        })?;
        (parse_config(&text)?, true, Vec::<String>::new())
    } else {
        (PluginConfig::default(), false, Vec::new())
    };

    let mut scan_truncated = false;
    let files = if snapshot.repository_path == snapshot.git_dir {
        diagnostics.push(
            "working-tree plugin scan is unavailable for a bare repository; file-based rules may have no candidates"
                .to_owned(),
        );
        Vec::new()
    } else {
        scan_repository_files(repository_root, options, &mut scan_truncated)?
    };
    let now_ms = now_ms.unwrap_or_else(current_time_ms);

    let mut results = Vec::new();
    results.push(run_security_audit(
        snapshot,
        &files,
        options,
        config.entries.get("security-audit"),
    ));
    results.push(run_license_check(
        &files,
        config.entries.get("license-check"),
    ));
    results.push(run_dependency_freshness(
        snapshot,
        &files,
        now_ms,
        config.entries.get("dependency-freshness"),
        options.max_findings_per_plugin,
    ));

    let manifests = discover_manifests(repository_root, &config, &mut diagnostics)?;
    for (manifest, enabled) in manifests {
        if enabled {
            results.push(run_manifest_plugin(
                &manifest,
                snapshot,
                &files,
                options.max_findings_per_plugin,
            ));
        } else {
            results.push(PluginResult {
                id: manifest.id,
                name: manifest.name,
                source: PluginSource::Manifest,
                status: PluginStatus::Disabled,
                findings: Vec::new(),
                metrics: Vec::new(),
                truncated: false,
            });
        }
    }

    let summary = summarize(&results);
    let result_truncated = results.iter().any(|result| result.truncated);
    Ok(PluginReport {
        schema_version: PLUGIN_REPORT_SCHEMA_VERSION,
        api_version: PLUGIN_API_VERSION,
        repository_revision: snapshot.revision.clone(),
        config_path: config_present.then(|| CONFIG_FILE.to_owned()),
        plugins: results,
        summary,
        diagnostics,
        truncated: scan_truncated || result_truncated,
    })
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn summarize(results: &[PluginResult]) -> PluginReportSummary {
    let mut summary = PluginReportSummary::default();
    for result in results {
        if result.status == PluginStatus::Disabled {
            summary.disabled_plugins += 1;
        } else {
            summary.enabled_plugins += 1;
        }
        for finding in &result.findings {
            match finding.severity {
                PluginSeverity::Info => summary.info_findings += 1,
                PluginSeverity::Warning => summary.warning_findings += 1,
                PluginSeverity::Error => summary.error_findings += 1,
            }
        }
    }
    summary
}

fn result_status(findings: &[PluginFinding]) -> PluginStatus {
    if findings
        .iter()
        .any(|finding| finding.severity == PluginSeverity::Error)
    {
        PluginStatus::Failed
    } else if findings
        .iter()
        .any(|finding| finding.severity == PluginSeverity::Warning)
    {
        PluginStatus::Warning
    } else {
        PluginStatus::Passed
    }
}

fn builtin_disabled(
    id: &str,
    name: &str,
    config: Option<&PluginConfigEntry>,
) -> Option<PluginResult> {
    if config.is_some_and(|entry| !entry.enabled) {
        Some(PluginResult {
            id: id.to_owned(),
            name: name.to_owned(),
            source: PluginSource::Builtin,
            status: PluginStatus::Disabled,
            findings: Vec::new(),
            metrics: Vec::new(),
            truncated: false,
        })
    } else {
        None
    }
}

fn run_security_audit(
    snapshot: &GitRepositorySnapshot,
    files: &[FileRecord],
    options: &PluginRunOptions,
    config: Option<&PluginConfigEntry>,
) -> PluginResult {
    const ID: &str = "security-audit";
    const NAME: &str = "Security audit";
    if let Some(disabled) = builtin_disabled(ID, NAME, config) {
        return disabled;
    }

    let mut findings = Vec::new();
    let mut sensitive_paths = 0i64;
    let mut secret_markers = 0i64;

    for hook in &snapshot.hooks {
        push_bounded(
            &mut findings,
            PluginFinding {
                rule_id: "active-hook".to_owned(),
                severity: PluginSeverity::Warning,
                message: format!("Repository hook is present: {hook}"),
                path: Some(format!(".git/hooks/{hook}")),
                commit_oid: None,
            },
            options.max_findings_per_plugin,
        );
    }

    for remote in &snapshot.remotes {
        for url in remote.fetch_urls.iter().chain(remote.push_urls.iter()) {
            if url.trim_start().starts_with("http://") {
                push_bounded(
                    &mut findings,
                    PluginFinding {
                        rule_id: "insecure-remote".to_owned(),
                        severity: PluginSeverity::Warning,
                        message: format!("Remote {} uses unencrypted HTTP transport", remote.name),
                        path: None,
                        commit_oid: None,
                    },
                    options.max_findings_per_plugin,
                );
            }
        }
    }

    let markers = [
        ["-----BEGIN ", "PRIVATE KEY-----"].concat(),
        ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].concat(),
        ["gh", "p_"].concat(),
        ["AK", "IA"].concat(),
    ];

    for file in files {
        let lower = file.path.to_ascii_lowercase();
        let basename = lower.rsplit('/').next().unwrap_or(lower.as_str());
        let sensitive = matches!(
            basename,
            ".env" | ".env.local" | ".env.production" | "id_rsa" | "id_dsa" | "id_ed25519"
        ) || basename.ends_with(".pem")
            || basename.ends_with(".key")
            || basename.ends_with(".p12");
        if sensitive {
            sensitive_paths += 1;
            push_bounded(
                &mut findings,
                PluginFinding {
                    rule_id: "sensitive-path".to_owned(),
                    severity: PluginSeverity::Warning,
                    message:
                        "Sensitive-looking credential or key path is present in the working tree"
                            .to_owned(),
                    path: Some(file.path.clone()),
                    commit_oid: None,
                },
                options.max_findings_per_plugin,
            );
        }

        if let Some(content) = &file.content {
            for marker in &markers {
                if content.contains(marker) {
                    secret_markers += 1;
                    push_bounded(
                        &mut findings,
                        PluginFinding {
                            rule_id: "secret-marker".to_owned(),
                            severity: PluginSeverity::Error,
                            message: "High-confidence credential marker appears in a bounded text file scan"
                                .to_owned(),
                            path: Some(file.path.clone()),
                            commit_oid: None,
                        },
                        options.max_findings_per_plugin,
                    );
                    break;
                }
            }
        }
    }

    let truncated = findings.len() >= options.max_findings_per_plugin
        && (sensitive_paths + secret_markers) as usize > findings.len();
    PluginResult {
        id: ID.to_owned(),
        name: NAME.to_owned(),
        source: PluginSource::Builtin,
        status: result_status(&findings),
        findings,
        metrics: vec![
            PluginMetric {
                name: "hooks".to_owned(),
                value: snapshot.hooks.len() as i64,
            },
            PluginMetric {
                name: "scannedFiles".to_owned(),
                value: files.len() as i64,
            },
            PluginMetric {
                name: "sensitivePaths".to_owned(),
                value: sensitive_paths,
            },
            PluginMetric {
                name: "secretMarkers".to_owned(),
                value: secret_markers,
            },
        ],
        truncated,
    }
}

fn run_license_check(files: &[FileRecord], config: Option<&PluginConfigEntry>) -> PluginResult {
    const ID: &str = "license-check";
    const NAME: &str = "License check";
    if let Some(disabled) = builtin_disabled(ID, NAME, config) {
        return disabled;
    }

    let require_license_file = config
        .and_then(|entry| entry.settings.get("require-license-file"))
        .and_then(|value| parse_bool(value))
        .unwrap_or(true);
    let license_files = files
        .iter()
        .filter(|file| {
            let basename = file
                .path
                .rsplit('/')
                .next()
                .unwrap_or(file.path.as_str())
                .to_ascii_lowercase();
            basename == "license"
                || basename.starts_with("license.")
                || basename == "copying"
                || basename.starts_with("copying.")
        })
        .count();

    let mut declarations = 0usize;
    for file in files {
        let basename = file.path.rsplit('/').next().unwrap_or(file.path.as_str());
        if !matches!(basename, "package.json" | "Cargo.toml" | "pyproject.toml") {
            continue;
        }
        let Some(content) = &file.content else {
            continue;
        };
        if content.contains("\"license\"")
            || content
                .lines()
                .any(|line| line.trim_start().starts_with("license ="))
        {
            declarations += 1;
        }
    }

    let mut findings = Vec::new();
    if require_license_file && license_files == 0 {
        findings.push(PluginFinding {
            rule_id: "license-file-required".to_owned(),
            severity: PluginSeverity::Warning,
            message: "No LICENSE or COPYING file was found in the bounded working-tree scan"
                .to_owned(),
            path: None,
            commit_oid: None,
        });
    }
    if license_files == 0 && declarations == 0 {
        findings.push(PluginFinding {
            rule_id: "license-metadata-missing".to_owned(),
            severity: PluginSeverity::Warning,
            message: "No obvious package license declaration was found in scanned manifests"
                .to_owned(),
            path: None,
            commit_oid: None,
        });
    }

    PluginResult {
        id: ID.to_owned(),
        name: NAME.to_owned(),
        source: PluginSource::Builtin,
        status: result_status(&findings),
        findings,
        metrics: vec![
            PluginMetric {
                name: "licenseFiles".to_owned(),
                value: license_files as i64,
            },
            PluginMetric {
                name: "licenseDeclarations".to_owned(),
                value: declarations as i64,
            },
        ],
        truncated: false,
    }
}

fn run_dependency_freshness(
    snapshot: &GitRepositorySnapshot,
    files: &[FileRecord],
    now_ms: i64,
    config: Option<&PluginConfigEntry>,
    max_findings: usize,
) -> PluginResult {
    const ID: &str = "dependency-freshness";
    const NAME: &str = "Dependency freshness";
    if let Some(disabled) = builtin_disabled(ID, NAME, config) {
        return disabled;
    }

    let max_age_days = config
        .and_then(|entry| entry.settings.get("max-age-days"))
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (1..=3_650).contains(value))
        .unwrap_or(180);
    let manifests: Vec<&FileRecord> = files
        .iter()
        .filter(|file| dependency_manifest(&file.path))
        .collect();

    let mut stale = 0i64;
    let mut unknown = 0i64;
    let mut findings = Vec::new();
    for manifest in &manifests {
        let touched = snapshot
            .commits
            .iter()
            .filter(|commit| {
                commit
                    .files
                    .iter()
                    .any(|changed| changed.path == manifest.path)
            })
            .map(|commit| commit.committed_at_ms)
            .max();

        match touched {
            Some(timestamp) => {
                let age_days = now_ms.saturating_sub(timestamp).max(0) / 86_400_000;
                if age_days > max_age_days {
                    stale += 1;
                    push_bounded(
                        &mut findings,
                        PluginFinding {
                            rule_id: "manifest-age".to_owned(),
                            severity: PluginSeverity::Warning,
                            message: format!(
                                "Dependency manifest has not changed for {age_days} days (threshold {max_age_days})"
                            ),
                            path: Some(manifest.path.clone()),
                            commit_oid: None,
                        },
                        max_findings,
                    );
                }
            }
            None => {
                unknown += 1;
                push_bounded(
                    &mut findings,
                    PluginFinding {
                        rule_id: "manifest-history-unknown".to_owned(),
                        severity: PluginSeverity::Info,
                        message: "Dependency manifest was not observed in the bounded commit history; freshness is unknown"
                            .to_owned(),
                        path: Some(manifest.path.clone()),
                        commit_oid: None,
                    },
                    max_findings,
                );
            }
        }
    }

    let truncated = findings.len() >= max_findings && (stale + unknown) as usize > findings.len();
    PluginResult {
        id: ID.to_owned(),
        name: NAME.to_owned(),
        source: PluginSource::Builtin,
        status: result_status(&findings),
        findings,
        metrics: vec![
            PluginMetric {
                name: "manifests".to_owned(),
                value: manifests.len() as i64,
            },
            PluginMetric {
                name: "staleManifests".to_owned(),
                value: stale,
            },
            PluginMetric {
                name: "unknownFreshness".to_owned(),
                value: unknown,
            },
            PluginMetric {
                name: "maxAgeDays".to_owned(),
                value: max_age_days,
            },
        ],
        truncated,
    }
}

fn dependency_manifest(path: &str) -> bool {
    let basename = path.rsplit('/').next().unwrap_or(path);
    matches!(
        basename,
        "package.json"
            | "pnpm-lock.yaml"
            | "package-lock.json"
            | "yarn.lock"
            | "Cargo.toml"
            | "Cargo.lock"
            | "pyproject.toml"
            | "requirements.txt"
            | "Pipfile"
            | "poetry.lock"
            | "go.mod"
            | "go.sum"
            | "Gemfile"
            | "Gemfile.lock"
    )
}

fn push_bounded(findings: &mut Vec<PluginFinding>, finding: PluginFinding, max_findings: usize) {
    if findings.len() < max_findings {
        findings.push(finding);
    }
}

fn scan_repository_files(
    repository_root: &Path,
    options: &PluginRunOptions,
    truncated: &mut bool,
) -> Result<Vec<FileRecord>, PluginError> {
    let mut records = Vec::new();
    let mut stack = vec![repository_root.to_path_buf()];
    let mut remaining_content = options.max_total_content_bytes;

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|source| PluginError::Io {
            path: directory.clone(),
            source,
        })?;
        let mut entries =
            entries
                .collect::<Result<Vec<_>, _>>()
                .map_err(|source| PluginError::Io {
                    path: directory.clone(),
                    source,
                })?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            if records.len() >= options.max_files {
                *truncated = true;
                return Ok(records);
            }
            let path = entry.path();
            let relative = relative_path(repository_root, &path)?;
            let basename = entry.file_name().to_string_lossy().to_string();
            let metadata = fs::symlink_metadata(&path).map_err(|source| PluginError::Io {
                path: path.clone(),
                source,
            })?;

            if metadata.file_type().is_symlink() {
                records.push(FileRecord {
                    path: relative,
                    size_bytes: metadata.len(),
                    content: None,
                });
                continue;
            }

            if metadata.is_dir() {
                if ignored_directory(&basename) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }

            let mut content = None;
            if metadata.len() <= options.max_file_bytes && metadata.len() <= remaining_content {
                let bytes = fs::read(&path).map_err(|source| PluginError::Io {
                    path: path.clone(),
                    source,
                })?;
                remaining_content = remaining_content.saturating_sub(bytes.len() as u64);
                if !bytes.iter().take(8 * 1024).any(|byte| *byte == 0)
                    && let Ok(text) = String::from_utf8(bytes)
                {
                    content = Some(text);
                }
            }
            records.push(FileRecord {
                path: relative,
                size_bytes: metadata.len(),
                content,
            });
        }
    }

    Ok(records)
}

fn ignored_directory(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | "coverage" | ".next" | ".cache"
    )
}

fn relative_path(root: &Path, path: &Path) -> Result<String, PluginError> {
    let relative = path.strip_prefix(root).map_err(|_| {
        PluginError::Config(format!(
            "plugin scan path escaped repository root: {}",
            path.display()
        ))
    })?;
    Ok(relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

fn parse_config(text: &str) -> Result<PluginConfig, PluginError> {
    let mut config = PluginConfig::default();
    let mut saw_version = false;
    let mut saw_plugins = false;
    let mut current_plugin: Option<String> = None;

    for (index, raw) in text.lines().enumerate() {
        let line_no = index + 1;
        if raw.contains('\t') {
            return Err(PluginError::Config(format!(
                "{CONFIG_FILE}:{line_no}: tabs are not allowed"
            )));
        }
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = raw.len() - raw.trim_start_matches(' ').len();
        match indent {
            0 => {
                current_plugin = None;
                let (key, value) = split_mapping(trimmed, line_no)?;
                match key {
                    "version" => {
                        if value != "1" {
                            return Err(PluginError::Config(format!(
                                "{CONFIG_FILE}:{line_no}: only version 1 is supported"
                            )));
                        }
                        saw_version = true;
                    }
                    "plugins" => {
                        if !value.is_empty() {
                            return Err(PluginError::Config(format!(
                                "{CONFIG_FILE}:{line_no}: plugins must be a mapping"
                            )));
                        }
                        saw_plugins = true;
                    }
                    other => {
                        return Err(PluginError::Config(format!(
                            "{CONFIG_FILE}:{line_no}: unknown root key {other}"
                        )));
                    }
                }
            }
            2 => {
                if !saw_plugins {
                    return Err(PluginError::Config(format!(
                        "{CONFIG_FILE}:{line_no}: plugin entries require a plugins mapping"
                    )));
                }
                let (plugin_id, value) = split_mapping(trimmed, line_no)?;
                if !value.is_empty() {
                    return Err(PluginError::Config(format!(
                        "{CONFIG_FILE}:{line_no}: plugin entry must be a mapping"
                    )));
                }
                validate_plugin_id(plugin_id)?;
                if config.entries.contains_key(plugin_id) {
                    return Err(PluginError::Config(format!(
                        "{CONFIG_FILE}:{line_no}: duplicate plugin {plugin_id}"
                    )));
                }
                config
                    .entries
                    .insert(plugin_id.to_owned(), PluginConfigEntry::default());
                current_plugin = Some(plugin_id.to_owned());
            }
            4 => {
                let plugin_id = current_plugin.as_ref().ok_or_else(|| {
                    PluginError::Config(format!(
                        "{CONFIG_FILE}:{line_no}: plugin setting has no plugin parent"
                    ))
                })?;
                let (key, raw_value) = split_mapping(trimmed, line_no)?;
                if raw_value.is_empty() {
                    return Err(PluginError::Config(format!(
                        "{CONFIG_FILE}:{line_no}: nested mappings and sequences are not supported"
                    )));
                }
                let value = parse_scalar(raw_value);
                let entry = config
                    .entries
                    .get_mut(plugin_id)
                    .expect("plugin entry exists");
                match key {
                    "enabled" => {
                        entry.enabled = parse_bool(&value).ok_or_else(|| {
                            PluginError::Config(format!(
                                "{CONFIG_FILE}:{line_no}: enabled must be true or false"
                            ))
                        })?;
                    }
                    "manifest" => entry.manifest = Some(value),
                    _ => {
                        entry.settings.insert(key.to_owned(), value);
                    }
                }
            }
            _ => {
                return Err(PluginError::Config(format!(
                    "{CONFIG_FILE}:{line_no}: only 0, 2, and 4-space indentation is supported"
                )));
            }
        }
    }

    if !saw_version {
        return Err(PluginError::Config(format!(
            "{CONFIG_FILE}: missing version: 1"
        )));
    }
    if !saw_plugins {
        return Err(PluginError::Config(format!(
            "{CONFIG_FILE}: missing plugins mapping"
        )));
    }
    Ok(config)
}

fn split_mapping(line: &str, line_no: usize) -> Result<(&str, &str), PluginError> {
    let (key, value) = line.split_once(':').ok_or_else(|| {
        PluginError::Config(format!(
            "{CONFIG_FILE}:{line_no}: expected key: value mapping"
        ))
    })?;
    let key = key.trim();
    if key.is_empty() {
        return Err(PluginError::Config(format!(
            "{CONFIG_FILE}:{line_no}: empty mapping key"
        )));
    }
    Ok((key, value.trim()))
}

fn parse_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return trimmed[1..trimmed.len() - 1].to_owned();
        }
    }
    trimmed.to_owned()
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" => Some(true),
        "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn validate_plugin_id(id: &str) -> Result<(), PluginError> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PluginError::Config(format!(
            "invalid plugin id {id:?}; use 1-80 ASCII letters, digits, '.', '_' or '-'"
        )));
    }
    Ok(())
}

fn validate_plugin_root(
    repository_root: &Path,
    plugin_root: &Path,
) -> Result<PathBuf, PluginError> {
    let relative = plugin_root.strip_prefix(repository_root).map_err(|_| {
        PluginError::Config(format!(
            "plugin directory escaped repository root: {}",
            plugin_root.display()
        ))
    })?;

    let mut current = repository_root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err(PluginError::Config(format!(
                "plugin directory contains an invalid path component: {}",
                plugin_root.display()
            )));
        };
        current.push(segment);
        let metadata = fs::symlink_metadata(&current).map_err(|source| PluginError::Io {
            path: current.clone(),
            source,
        })?;
        if metadata.file_type().is_symlink() {
            return Err(PluginError::Config(format!(
                "plugin directory components must not be symlinks: {}",
                current.display()
            )));
        }
    }

    let canonical_repository_root =
        fs::canonicalize(repository_root).map_err(|source| PluginError::Io {
            path: repository_root.to_path_buf(),
            source,
        })?;
    let canonical_plugin_root =
        fs::canonicalize(plugin_root).map_err(|source| PluginError::Io {
            path: plugin_root.to_path_buf(),
            source,
        })?;
    if !canonical_plugin_root.starts_with(&canonical_repository_root) {
        return Err(PluginError::Config(format!(
            "plugin directory must stay inside the repository: {}",
            plugin_root.display()
        )));
    }
    Ok(canonical_plugin_root)
}

fn discover_manifests(
    repository_root: &Path,
    config: &PluginConfig,
    diagnostics: &mut Vec<String>,
) -> Result<Vec<(PluginManifest, bool)>, PluginError> {
    let plugin_root = repository_root.join(PLUGIN_DIR);
    let mut requested = BTreeMap::<PathBuf, Option<String>>::new();

    if plugin_root.exists() {
        let validated_plugin_root = validate_plugin_root(repository_root, &plugin_root)?;
        if !validated_plugin_root.is_dir() {
            return Err(PluginError::Config(format!(
                "{PLUGIN_DIR} must be a directory"
            )));
        }
        let mut entries = fs::read_dir(&validated_plugin_root)
            .map_err(|source| PluginError::Io {
                path: validated_plugin_root.clone(),
                source,
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|source| PluginError::Io {
                path: validated_plugin_root.clone(),
                source,
            })?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                requested.insert(path, None);
            }
        }
    }

    for (id, entry) in &config.entries {
        if let Some(manifest) = &entry.manifest {
            requested.insert(repository_root.join(manifest), Some(id.clone()));
        } else if !is_builtin(id) {
            diagnostics.push(format!(
                "plugin {id} has configuration but no manifest; expected a built-in id or manifest path"
            ));
        }
    }

    let mut seen_ids = BTreeSet::new();
    let mut manifests = Vec::new();
    for (path, configured_id) in requested {
        match load_manifest(
            repository_root,
            &plugin_root,
            &path,
            configured_id.as_deref(),
        ) {
            Ok(manifest) => {
                if !seen_ids.insert(manifest.id.clone()) {
                    diagnostics.push(format!(
                        "duplicate declarative plugin id {} was skipped",
                        manifest.id
                    ));
                    continue;
                }
                let enabled = config
                    .entries
                    .get(&manifest.id)
                    .map(|entry| entry.enabled)
                    .unwrap_or(true);
                manifests.push((manifest, enabled));
            }
            Err(error) => diagnostics.push(error.to_string()),
        }
    }
    Ok(manifests)
}

fn is_builtin(id: &str) -> bool {
    matches!(
        id,
        "security-audit" | "license-check" | "dependency-freshness"
    )
}

fn load_manifest(
    repository_root: &Path,
    plugin_root: &Path,
    path: &Path,
    configured_id: Option<&str>,
) -> Result<PluginManifest, PluginError> {
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err(PluginError::Config(format!(
            "plugin manifest must use .json: {}",
            path.display()
        )));
    }
    let metadata = fs::symlink_metadata(path).map_err(|source| PluginError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(PluginError::Config(format!(
            "plugin manifest must be a regular file: {}",
            path.display()
        )));
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PluginError::Config(format!(
            "plugin manifest exceeds {MAX_MANIFEST_BYTES} bytes: {}",
            path.display()
        )));
    }

    let canonical_root = validate_plugin_root(repository_root, plugin_root)?;
    let canonical_path = fs::canonicalize(path).map_err(|source| PluginError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(PluginError::Config(format!(
            "plugin manifest must stay inside {PLUGIN_DIR}: {}",
            path.display()
        )));
    }

    let raw = fs::read_to_string(&canonical_path).map_err(|source| PluginError::Io {
        path: canonical_path.clone(),
        source,
    })?;
    let manifest: PluginManifest = serde_json::from_str(&raw).map_err(|error| {
        PluginError::Config(format!(
            "invalid declarative plugin {}: {error}",
            relative_path(repository_root, &canonical_path)
                .unwrap_or_else(|_| canonical_path.display().to_string())
        ))
    })?;
    validate_manifest(&manifest)?;
    if let Some(configured_id) = configured_id
        && configured_id != manifest.id
    {
        return Err(PluginError::Config(format!(
            "configured plugin id {configured_id} does not match manifest id {}",
            manifest.id
        )));
    }
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), PluginError> {
    if manifest.schema_version != PLUGIN_API_VERSION {
        return Err(PluginError::Config(format!(
            "plugin {} uses schemaVersion {}, expected {}",
            manifest.id, manifest.schema_version, PLUGIN_API_VERSION
        )));
    }
    validate_plugin_id(&manifest.id)?;
    if manifest.name.trim().is_empty() || manifest.name.len() > 160 {
        return Err(PluginError::Config(format!(
            "plugin {} name must contain 1-160 characters",
            manifest.id
        )));
    }
    if manifest.rules.is_empty() || manifest.rules.len() > 200 {
        return Err(PluginError::Config(format!(
            "plugin {} must contain 1-200 declarative rules",
            manifest.id
        )));
    }
    let mut ids = BTreeSet::new();
    for rule in &manifest.rules {
        validate_plugin_id(&rule.id)?;
        if !ids.insert(rule.id.clone()) {
            return Err(PluginError::Config(format!(
                "plugin {} has duplicate rule {}",
                manifest.id, rule.id
            )));
        }
        validate_rule(rule)?;
    }
    Ok(())
}

fn validate_rule(rule: &PluginRule) -> Result<(), PluginError> {
    let supported = match rule.source {
        PluginRuleSource::Repository => matches!(
            rule.field.as_str(),
            "revision" | "head" | "headRef" | "hook" | "remoteUrl"
        ),
        PluginRuleSource::Commit => matches!(
            rule.field.as_str(),
            "message"
                | "authorName"
                | "signatureStatus"
                | "parentCount"
                | "authoredAtMs"
                | "committedAtMs"
        ),
        PluginRuleSource::File => {
            matches!(rule.field.as_str(), "path" | "extension" | "sizeBytes")
        }
        PluginRuleSource::Diff => matches!(
            rule.field.as_str(),
            "path" | "status" | "kind" | "additions" | "deletions"
        ),
    };
    if !supported {
        return Err(PluginError::Config(format!(
            "rule {} references unsupported {:?} field {}",
            rule.id, rule.source, rule.field
        )));
    }

    let numeric_field = matches!(
        rule.field.as_str(),
        "parentCount" | "authoredAtMs" | "committedAtMs" | "sizeBytes" | "additions" | "deletions"
    );
    let numeric_operator = matches!(
        rule.operator,
        PluginRuleOperator::Gt
            | PluginRuleOperator::Gte
            | PluginRuleOperator::Lt
            | PluginRuleOperator::Lte
    );
    if numeric_operator && (!numeric_field || !rule.value.is_number()) {
        return Err(PluginError::Config(format!(
            "rule {} numeric comparison requires a numeric field and value",
            rule.id
        )));
    }
    if matches!(
        rule.operator,
        PluginRuleOperator::Contains | PluginRuleOperator::Prefix | PluginRuleOperator::Suffix
    ) && !rule.value.is_string()
    {
        return Err(PluginError::Config(format!(
            "rule {} string comparison requires a string value",
            rule.id
        )));
    }
    Ok(())
}

fn run_manifest_plugin(
    manifest: &PluginManifest,
    snapshot: &GitRepositorySnapshot,
    files: &[FileRecord],
    max_findings: usize,
) -> PluginResult {
    let mut findings = Vec::new();
    let mut metrics = Vec::new();
    let mut total_matches = 0usize;

    for rule in &manifest.rules {
        let candidates = candidates_for_rule(rule, snapshot, files);
        let mut matches = 0i64;
        for candidate in candidates {
            if !rule_matches(rule, &candidate.value) {
                continue;
            }
            matches += 1;
            total_matches += 1;
            if findings.len() < max_findings {
                findings.push(PluginFinding {
                    rule_id: rule.id.clone(),
                    severity: rule.severity,
                    message: render_rule_message(rule, &candidate),
                    path: candidate.path,
                    commit_oid: candidate.commit_oid,
                });
            }
        }
        metrics.push(PluginMetric {
            name: rule
                .metric
                .clone()
                .unwrap_or_else(|| format!("rule.{}.matches", rule.id)),
            value: matches,
        });
    }

    let truncated = total_matches > findings.len();
    PluginResult {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        source: PluginSource::Manifest,
        status: result_status(&findings),
        findings,
        metrics,
        truncated,
    }
}

fn render_rule_message(rule: &PluginRule, candidate: &RuleCandidate) -> String {
    let rendered_value = match &candidate.value {
        Value::String(value) => value.clone(),
        value => value.to_string(),
    };
    rule.message
        .replace("{value}", &rendered_value)
        .replace("{path}", candidate.path.as_deref().unwrap_or(""))
        .replace("{commit}", candidate.commit_oid.as_deref().unwrap_or(""))
}

fn candidates_for_rule(
    rule: &PluginRule,
    snapshot: &GitRepositorySnapshot,
    files: &[FileRecord],
) -> Vec<RuleCandidate> {
    match rule.source {
        PluginRuleSource::Repository => repository_candidates(rule, snapshot),
        PluginRuleSource::Commit => snapshot
            .commits
            .iter()
            .filter_map(|commit| commit_candidate(rule, commit))
            .collect(),
        PluginRuleSource::File => files
            .iter()
            .filter_map(|file| file_candidate(rule, file))
            .collect(),
        PluginRuleSource::Diff => snapshot
            .commits
            .iter()
            .flat_map(|commit| {
                commit.files.iter().filter_map(move |file| {
                    let value = match rule.field.as_str() {
                        "path" => Value::String(file.path.clone()),
                        "status" => {
                            Value::String(format!("{:?}", file.status).to_ascii_lowercase())
                        }
                        "kind" => Value::String(format!("{:?}", file.kind).to_ascii_lowercase()),
                        "additions" => Value::from(file.additions),
                        "deletions" => Value::from(file.deletions),
                        _ => return None,
                    };
                    Some(RuleCandidate {
                        value,
                        path: Some(file.path.clone()),
                        commit_oid: Some(commit.oid.clone()),
                    })
                })
            })
            .collect(),
    }
}

fn repository_candidates(
    rule: &PluginRule,
    snapshot: &GitRepositorySnapshot,
) -> Vec<RuleCandidate> {
    let string_candidate = |value: Option<String>| {
        value
            .map(|value| {
                vec![RuleCandidate {
                    value: Value::String(value),
                    path: None,
                    commit_oid: None,
                }]
            })
            .unwrap_or_default()
    };

    match rule.field.as_str() {
        "revision" => string_candidate(Some(snapshot.revision.clone())),
        "head" => string_candidate(snapshot.head.clone()),
        "headRef" => string_candidate(snapshot.head_ref.clone()),
        "hook" => snapshot
            .hooks
            .iter()
            .cloned()
            .map(|value| RuleCandidate {
                value: Value::String(value),
                path: None,
                commit_oid: None,
            })
            .collect(),
        "remoteUrl" => snapshot
            .remotes
            .iter()
            .flat_map(|remote| remote.fetch_urls.iter().chain(remote.push_urls.iter()))
            .cloned()
            .map(|value| RuleCandidate {
                value: Value::String(value),
                path: None,
                commit_oid: None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn commit_candidate(rule: &PluginRule, commit: &GitCommitRecord) -> Option<RuleCandidate> {
    let value = match rule.field.as_str() {
        "message" => Value::String(commit.message.clone()),
        "authorName" => Value::String(commit.author_name.clone()),
        "signatureStatus" => {
            Value::String(format!("{:?}", commit.signature_status).to_ascii_lowercase())
        }
        "parentCount" => Value::from(commit.parents.len() as u64),
        "authoredAtMs" => Value::from(commit.authored_at_ms),
        "committedAtMs" => Value::from(commit.committed_at_ms),
        _ => return None,
    };
    Some(RuleCandidate {
        value,
        path: None,
        commit_oid: Some(commit.oid.clone()),
    })
}

fn file_candidate(rule: &PluginRule, file: &FileRecord) -> Option<RuleCandidate> {
    let value = match rule.field.as_str() {
        "path" => Value::String(file.path.clone()),
        "extension" => Value::String(
            Path::new(&file.path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_owned(),
        ),
        "sizeBytes" => Value::from(file.size_bytes),
        _ => return None,
    };
    Some(RuleCandidate {
        value,
        path: Some(file.path.clone()),
        commit_oid: None,
    })
}

fn rule_matches(rule: &PluginRule, candidate: &Value) -> bool {
    match rule.operator {
        PluginRuleOperator::Equals => values_equal(candidate, &rule.value, rule.case_sensitive),
        PluginRuleOperator::Contains => {
            string_compare(candidate, &rule.value, rule.case_sensitive, |a, b| {
                a.contains(b)
            })
        }
        PluginRuleOperator::Prefix => {
            string_compare(candidate, &rule.value, rule.case_sensitive, |a, b| {
                a.starts_with(b)
            })
        }
        PluginRuleOperator::Suffix => {
            string_compare(candidate, &rule.value, rule.case_sensitive, |a, b| {
                a.ends_with(b)
            })
        }
        PluginRuleOperator::Gt => numeric_compare(candidate, &rule.value, |a, b| a > b),
        PluginRuleOperator::Gte => numeric_compare(candidate, &rule.value, |a, b| a >= b),
        PluginRuleOperator::Lt => numeric_compare(candidate, &rule.value, |a, b| a < b),
        PluginRuleOperator::Lte => numeric_compare(candidate, &rule.value, |a, b| a <= b),
    }
}

fn values_equal(candidate: &Value, expected: &Value, case_sensitive: bool) -> bool {
    match (candidate, expected) {
        (Value::String(left), Value::String(right)) if !case_sensitive => {
            left.eq_ignore_ascii_case(right)
        }
        _ => candidate == expected,
    }
}

fn string_compare(
    candidate: &Value,
    expected: &Value,
    case_sensitive: bool,
    compare: impl Fn(&str, &str) -> bool,
) -> bool {
    let (Some(candidate), Some(expected)) = (candidate.as_str(), expected.as_str()) else {
        return false;
    };
    if case_sensitive {
        compare(candidate, expected)
    } else {
        compare(
            &candidate.to_ascii_lowercase(),
            &expected.to_ascii_lowercase(),
        )
    }
}

fn numeric_compare(
    candidate: &Value,
    expected: &Value,
    compare: impl Fn(f64, f64) -> bool,
) -> bool {
    match (candidate.as_f64(), expected.as_f64()) {
        (Some(candidate), Some(expected)) => compare(candidate, expected),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        FileKind, FileStatus, GitCommitFileChange, GitRefRecord, GitRemoteRecord, RefKind,
        SignatureStatus,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        path: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("plugin-fixtures")
                .join(format!("{}-{serial}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.path.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, contents).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn snapshot() -> GitRepositorySnapshot {
        GitRepositorySnapshot {
            schema_version: 1,
            repository_path: "/repo".to_owned(),
            git_dir: "/repo/.git".to_owned(),
            head: Some("abc".to_owned()),
            head_ref: Some("refs/heads/main".to_owned()),
            revision: "rev-1".to_owned(),
            commits: vec![GitCommitRecord {
                oid: "abc".to_owned(),
                tree_oid: "tree".to_owned(),
                parents: vec!["parent".to_owned()],
                author_name: "Fixture".to_owned(),
                author_email: None,
                authored_at_ms: 1_700_000_000_000,
                committed_at_ms: 1_700_000_000_000,
                message: "update dependencies".to_owned(),
                signature_status: SignatureStatus::Unsigned,
                files: vec![GitCommitFileChange {
                    path: "package.json".to_owned(),
                    kind: FileKind::Text,
                    additions: 2,
                    deletions: 1,
                    bytes: Some(80),
                    status: FileStatus::Modified,
                }],
            }],
            refs: vec![GitRefRecord {
                name: "refs/heads/main".to_owned(),
                target_oid: "abc".to_owned(),
                kind: RefKind::LocalBranch,
                symbolic_target: None,
                upstream: None,
                ahead: None,
                behind: None,
            }],
            remotes: vec![GitRemoteRecord {
                name: "origin".to_owned(),
                fetch_urls: vec!["https://example.invalid/repo.git".to_owned()],
                push_urls: vec!["https://example.invalid/repo.git".to_owned()],
            }],
            hooks: Vec::new(),
            truncated: false,
        }
    }

    #[test]
    fn config_parser_accepts_only_bounded_mapping_shape() {
        let config = parse_config(
            "version: 1\nplugins:\n  security-audit:\n    enabled: false\n  dependency-freshness:\n    max-age-days: 30\n  local-policy:\n    manifest: .gitinspect/plugins/local-policy.json\n",
        )
        .unwrap();
        assert!(!config.entries["security-audit"].enabled);
        assert_eq!(
            config.entries["dependency-freshness"].settings["max-age-days"],
            "30"
        );
        assert_eq!(
            config.entries["local-policy"].manifest.as_deref(),
            Some(".gitinspect/plugins/local-policy.json")
        );

        assert!(parse_config("plugins:\n  x:\n    enabled: true\n").is_err());
        assert!(parse_config("version: 1\nplugins:\n  x:\n      enabled: true\n").is_err());
        assert!(
            parse_config("version: 1\nplugins:\n  x:\n    enabled:\n      nested: true\n").is_err()
        );
    }

    #[test]
    fn manifest_schema_rejects_executable_or_unknown_fields() {
        let raw = r#"{
          "schemaVersion": 1,
          "id": "unsafe",
          "name": "unsafe",
          "command": "sh -c whoami",
          "rules": [{
            "id": "one",
            "source": "file",
            "field": "path",
            "operator": "contains",
            "value": "src/",
            "message": "{path}"
          }]
        }"#;
        assert!(serde_json::from_str::<PluginManifest>(raw).is_err());
    }

    #[test]
    fn builtins_and_declarative_rules_share_bounded_report_output() {
        let fixture = Fixture::new();
        fixture.write("LICENSE", "MIT\n");
        fixture.write("package.json", "{\"license\":\"MIT\"}\n");
        fixture.write("src/main.rs", "fn main() {}\n");
        fixture.write(
            ".gitinspect/plugins/source-policy.json",
            r#"{
              "schemaVersion": 1,
              "id": "source-policy",
              "name": "Source policy",
              "description": "Demonstrates the declarative file/diff API",
              "rules": [
                {
                  "id": "rust-files",
                  "source": "file",
                  "field": "extension",
                  "operator": "equals",
                  "value": "rs",
                  "severity": "info",
                  "message": "Rust source: {path}",
                  "metric": "rustFiles"
                },
                {
                  "id": "manifest-diff",
                  "source": "diff",
                  "field": "path",
                  "operator": "equals",
                  "value": "package.json",
                  "severity": "warning",
                  "message": "Dependency manifest changed in {commit}"
                }
              ]
            }"#,
        );
        fixture.write(
            ".gitinspect.yml",
            "version: 1\nplugins:\n  dependency-freshness:\n    max-age-days: 180\n",
        );

        let report = run_plugins_for_snapshot(
            &fixture.path,
            &snapshot(),
            &PluginRunOptions::default(),
            Some(1_700_000_000_000 + 30 * 86_400_000),
        )
        .unwrap();

        assert_eq!(report.api_version, 1);
        assert_eq!(report.repository_revision, "rev-1");
        assert_eq!(report.config_path.as_deref(), Some(CONFIG_FILE));
        assert!(
            report
                .plugins
                .iter()
                .any(|plugin| plugin.id == "security-audit")
        );
        assert!(
            report
                .plugins
                .iter()
                .any(|plugin| plugin.id == "license-check")
        );
        assert!(
            report
                .plugins
                .iter()
                .any(|plugin| plugin.id == "dependency-freshness")
        );
        let custom = report
            .plugins
            .iter()
            .find(|plugin| plugin.id == "source-policy")
            .unwrap();
        assert_eq!(custom.source, PluginSource::Manifest);
        assert_eq!(
            custom
                .metrics
                .iter()
                .find(|metric| metric.name == "rustFiles")
                .unwrap()
                .value,
            1
        );
        assert!(
            custom
                .findings
                .iter()
                .any(|finding| finding.rule_id == "manifest-diff")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_plugin_parent_cannot_escape_repository() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = Fixture::new();
        outside.write(
            "plugins/escaped.json",
            r#"{
              "schemaVersion": 1,
              "id": "escaped",
              "name": "Escaped plugin",
              "rules": [{
                "id": "one",
                "source": "file",
                "field": "path",
                "operator": "contains",
                "value": "src/",
                "message": "{path}"
              }]
            }"#,
        );
        symlink(&outside.path, fixture.path.join(".gitinspect")).unwrap();

        let error = run_plugins_for_snapshot(
            &fixture.path,
            &snapshot(),
            &PluginRunOptions::default(),
            Some(1_700_000_000_000),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("plugin directory components must not be symlinks")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_plugin_directory_cannot_escape_repository() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = Fixture::new();
        fs::create_dir_all(fixture.path.join(".gitinspect")).unwrap();
        outside.write(
            "escaped.json",
            r#"{
              "schemaVersion": 1,
              "id": "escaped",
              "name": "Escaped plugin",
              "rules": [{
                "id": "one",
                "source": "repository",
                "field": "revision",
                "operator": "equals",
                "value": "rev-1",
                "message": "{value}"
              }]
            }"#,
        );
        symlink(
            &outside.path,
            fixture.path.join(".gitinspect/plugins"),
        )
        .unwrap();

        let error = run_plugins_for_snapshot(
            &fixture.path,
            &snapshot(),
            &PluginRunOptions::default(),
            Some(1_700_000_000_000),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("plugin directory components must not be symlinks")
        );
    }

    #[test]
    fn configured_manifest_cannot_escape_plugin_directory() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.path.join(".gitinspect/plugins")).unwrap();
        fixture.write("outside.json", "{}");
        fixture.write(
            ".gitinspect.yml",
            "version: 1\nplugins:\n  escape:\n    manifest: outside.json\n",
        );
        let report = run_plugins_for_snapshot(
            &fixture.path,
            &snapshot(),
            &PluginRunOptions::default(),
            Some(1_700_000_000_000),
        )
        .unwrap();
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("must stay inside"))
        );
        assert!(!report.plugins.iter().any(|plugin| plugin.id == "escape"));
    }
}
