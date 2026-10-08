//! Native-versus-inflated-object equivalence probe.
//! Run with `cargo test --manifest-path crates/gitinspect-core/Cargo.toml --example snapshot_equivalence`.
//! Git subprocesses and fixture files are confined to a repository-local temporary directory.

#[cfg(test)]
mod tests {
    use gitinspect_core::{OpenOptions, RepositoryService};
    use gitinspect_model::{InMemorySource, SourceRef, assemble_graph};
    use std::{fs, path::Path, process::Command};

    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Ada")
            .env("GIT_AUTHOR_EMAIL", "ada@example.org")
            .env("GIT_COMMITTER_NAME", "Ada")
            .env("GIT_COMMITTER_EMAIL", "ada@example.org")
            .env("GIT_AUTHOR_DATE", "@1700000000 +0000")
            .env("GIT_COMMITTER_DATE", "@1700000000 +0000")
            .output()
            .expect("git available");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    #[test]
    fn linear_fixture_matches_every_commit_and_ref_field() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join(".snapshot-equivalence-fixture");
        // Never remove another worker's fixture: use exclusive creation and fail closed.
        let unique = fixture.join(format!("{}", std::process::id()));
        fs::create_dir_all(&fixture).unwrap();
        fs::create_dir(&unique).expect("exclusive fixture directory");
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(unique.clone());
        git(&unique, &["init", "-q", "-b", "main"]);
        for (name, content) in [("a.txt", "alpha\n"), ("b.txt", "beta\n")] {
            fs::write(unique.join(name), content).unwrap();
            git(&unique, &["add", name]);
            git(&unique, &["commit", "-qm", name]);
        }
        git(&unique, &["tag", "v1"]);
        let (_, native) = RepositoryService::open(&unique, OpenOptions::default()).unwrap();
        let refs = native
            .refs
            .iter()
            .filter(|r| !r.name.contains("@{"))
            .map(|r| SourceRef {
                name: r.name.clone(),
                target: r.target_oid.clone(),
            })
            .collect();
        let oids = git(&unique, &["rev-list", "--objects", "--all"]);
        let commits = oids
            .lines()
            .filter_map(|line| {
                let oid = line.split_whitespace().next().unwrap();
                if git(&unique, &["cat-file", "-t", oid]) != "commit" {
                    return None;
                }
                // `cat-file commit` returns the raw inflated commit body, not pretty-printed content.
                let bytes = Command::new("git")
                    .args(["cat-file", "commit", oid])
                    .current_dir(&unique)
                    .output()
                    .unwrap();
                assert!(bytes.status.success());
                Some((oid.to_owned(), bytes.stdout))
            })
            .collect::<Vec<_>>();
        let source = InMemorySource::new(commits, refs).unwrap();
        let model = assemble_graph(&source, OpenOptions::default().max_commits).unwrap();
        assert_eq!(
            native.commits, model.commits,
            "ordered native commit records diverge"
        );
        assert_eq!(native.refs, model.refs, "native ref records diverge");
        assert_eq!(native.truncated, model.truncated);
        assert_eq!(native.head, native.commits.first().map(|c| c.oid.clone()));
        assert_eq!(native.head_ref.as_deref(), Some("refs/heads/main"));
        assert!(native.revision.starts_with("sha256:"));
        assert!(native.remotes.is_empty());
        assert!(native.hooks.is_empty());
        // Normalize authority-bearing paths, which vary between worktrees and CI runners.
        // The golden is otherwise the exact native JSON, including revision fingerprint.
        let mut golden = serde_json::to_value(&native).unwrap();
        golden["repositoryPath"] = serde_json::Value::String("<fixture>".into());
        golden["gitDir"] = serde_json::Value::String("<fixture>/.git".into());
        let serialized = serde_json::to_string_pretty(&golden).unwrap();
        if std::env::var_os("GITINSPECT_PRINT_GOLDEN").is_some() {
            println!("GOLDEN_BEGIN\n{serialized}\nGOLDEN_END");
        } else {
            let expected: serde_json::Value =
                serde_json::from_str(include_str!("fixtures/snapshot-equivalence.json")).unwrap();
            assert_eq!(
                golden, expected,
                "native snapshot drifted from checked-in golden"
            );
        }
    }
}

fn main() {}
