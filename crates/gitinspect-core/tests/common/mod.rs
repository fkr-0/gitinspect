use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

pub struct FixtureRepo {
    pub path: PathBuf,
}

impl FixtureRepo {
    pub fn new(name: &str) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tmp-test");
        fs::create_dir_all(&root).unwrap();
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = root.join(format!("{name}-{}-{serial}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).unwrap();
        }
        fs::create_dir_all(&path).unwrap();
        run(&path, ["init", "-b", "main"]);
        run(&path, ["config", "user.name", "Fixture User"]);
        run(&path, ["config", "user.email", "fixture@example.invalid"]);
        Self { path }
    }

    pub fn write(&self, relative: &str, contents: impl AsRef<[u8]>) {
        let path = self.path.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    pub fn commit_all(&self, message: &str) -> String {
        run(&self.path, ["add", "-A"]);
        run_env(
            &self.path,
            ["commit", "-m", message],
            [
                ("GIT_AUTHOR_NAME", "Fixture User"),
                ("GIT_AUTHOR_EMAIL", "fixture@example.invalid"),
                ("GIT_COMMITTER_NAME", "Fixture User"),
                ("GIT_COMMITTER_EMAIL", "fixture@example.invalid"),
                ("GIT_AUTHOR_DATE", "2024-01-01T12:00:00Z"),
                ("GIT_COMMITTER_DATE", "2024-01-01T12:00:00Z"),
            ],
        );
        output(&self.path, ["rev-parse", "HEAD"])
    }

    pub fn git<const N: usize>(&self, args: [&str; N]) {
        run(&self.path, args);
    }
}

impl Drop for FixtureRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run<I, S>(cwd: &Path, args: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .unwrap();
    assert!(status.success());
}

fn run_env<I, S, E, K, V>(cwd: &Path, args: I, env: E)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
    E: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let status = Command::new("git")
        .args(args)
        .envs(env)
        .current_dir(cwd)
        .status()
        .unwrap();
    assert!(status.success());
}

fn output<I, S>(cwd: &Path, args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}
