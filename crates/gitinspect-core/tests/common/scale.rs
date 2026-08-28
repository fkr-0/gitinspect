use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const BASE_TIMESTAMP: i64 = 1_700_000_000;

pub struct ScaleFixture {
    pub path: PathBuf,
}

impl ScaleFixture {
    pub fn new(name: &str, commit_count: usize) -> Self {
        assert!(commit_count > 0);
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("scale-regression");
        fs::create_dir_all(&root).unwrap();
        let path = root.join(name);
        if path.exists() {
            fs::remove_dir_all(&path).unwrap();
        }
        fs::create_dir_all(&path).unwrap();
        run_git(&path, &["init", "-q", "-b", "main"]);

        let mut child = Command::new("git")
            .args(["fast-import", "--quiet"])
            .current_dir(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        {
            let stream = child.stdin.as_mut().unwrap();
            for index in 0..commit_count {
                let mark = index + 1;
                let timestamp = BASE_TIMESTAMP + index as i64;
                writeln!(stream, "commit refs/heads/main").unwrap();
                writeln!(stream, "mark :{mark}").unwrap();
                writeln!(
                    stream,
                    "author Scale Fixture <scale@example.invalid> {timestamp} +0000"
                )
                .unwrap();
                writeln!(
                    stream,
                    "committer Scale Fixture <scale@example.invalid> {timestamp} +0000"
                )
                .unwrap();
                let message = format!("synthetic commit {index}\n");
                write_data(stream, &message);
                if index > 0 {
                    writeln!(stream, "from :{index}").unwrap();
                }
                writeln!(stream, "M 100644 inline state.txt").unwrap();
                write_data(stream, "synthetic scale fixture\n");
                writeln!(stream).unwrap();
            }
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "fast-import failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        Self { path }
    }

    pub fn append_commit(&self, ordinal: usize, label: &str) -> String {
        let parent = self.output(&["rev-parse", "HEAD"]);
        let timestamp = BASE_TIMESTAMP + ordinal as i64;
        let mut child = Command::new("git")
            .args(["fast-import", "--quiet"])
            .current_dir(&self.path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        {
            let stream = child.stdin.as_mut().unwrap();
            writeln!(stream, "commit refs/heads/main").unwrap();
            writeln!(
                stream,
                "author Scale Fixture <scale@example.invalid> {timestamp} +0000"
            )
            .unwrap();
            writeln!(
                stream,
                "committer Scale Fixture <scale@example.invalid> {timestamp} +0000"
            )
            .unwrap();
            write_data(stream, &format!("{label} {ordinal}\n"));
            writeln!(stream, "from {parent}").unwrap();
            writeln!(stream, "M 100644 inline state.txt").unwrap();
            write_data(stream, &format!("{label} fixture {ordinal}\n"));
            writeln!(stream).unwrap();
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "append fast-import failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        self.output(&["rev-parse", "HEAD"])
    }

    pub fn create_branch(&self, name: &str, target: &str) {
        run_git(&self.path, &["branch", name, target]);
    }

    pub fn reset_hard(&self, target: &str) {
        run_git(&self.path, &["reset", "--hard", target]);
    }

    pub fn output(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }
}

impl Drop for ScaleFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_data(stream: &mut impl Write, value: &str) {
    writeln!(stream, "data {}", value.len()).unwrap();
    write!(stream, "{value}").unwrap();
    if !value.ends_with('\n') {
        writeln!(stream).unwrap();
    }
}

fn run_git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
