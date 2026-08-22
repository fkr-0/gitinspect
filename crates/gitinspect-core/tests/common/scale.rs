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
