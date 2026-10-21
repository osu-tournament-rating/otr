use clap::Parser;
use std::path::{Path, PathBuf};

#[derive(Parser, Clone)]
#[command(
    display_name = "o!TR Processor",
    author = "osu! Tournament Rating",
    long_about = "Generates ratings for the osu! Tournament Rating platform"
)]
pub struct Args {
    /// Log level (trace, debug, info, warn, error)
    #[arg(
        short,
        long,
        env = "RUST_LOG", 
        default_value = "info", 
        value_parser = ["trace", "debug", "info", "warn", "error"],
        help = "Sets the logging verbosity"
    )]
    pub log_level: String
}

/// Database URL variables, preferred first. `DATABASE_URL` is the name otr
/// shares, and the production cron passes it. otr-replay and the manual rating
/// reproduction steps pass `CONNECTION_STRING`, the one name every release
/// reads, so the fallback stays.
pub const DATABASE_URL_VARS: [&str; 2] = ["DATABASE_URL", "CONNECTION_STRING"];

/// The value of the first variable in `names` that is set and not blank.
pub fn first_env(names: &[&str]) -> Option<String> {
    first_set(names, |name| std::env::var(name).ok())
}

fn first_set(names: &[&str], lookup: impl Fn(&str) -> Option<String>) -> Option<String> {
    names
        .iter()
        .filter_map(|name| lookup(name))
        .find(|value| !value.trim().is_empty())
}

/// How the block that `apps/scripts/otr up` writes into a worktree's `.env`
/// begins (`BEGIN` in apps/scripts/src/lib/stack/envfile.py).
pub const STACK_BLOCK_START: &str = "# >>> otr stack";

/// The linked git worktree containing `dir` when the `.env` that dotenvy
/// loaded (`loaded`) cannot be trusted to name that worktree's database.
///
/// A new worktree starts with a copy of the main checkout's `.env`, which
/// names the developer's database, until `otr up` writes the stack's block
/// into it. Worktrees can also sit inside the main checkout, where dotenvy,
/// which searches parent directories, finds the main checkout's own `.env`
/// when the worktree has none. Returns `None` outside a linked worktree, and
/// inside one whose own `.env` was loaded and holds the stack's block.
pub fn worktree_without_stack(dir: &Path, loaded: Option<&Path>) -> Option<PathBuf> {
    let root = dir.ancestors().find(|ancestor| ancestor.join(".git").exists())?;
    // The main checkout has a `.git` directory; a linked worktree, a file
    if !root.join(".git").is_file() {
        return None;
    }

    let env = root.join(".env");
    let stacked = loaded == Some(env.as_path())
        && std::fs::read_to_string(&env)
            .is_ok_and(|text| text.lines().any(|line| line.trim().starts_with(STACK_BLOCK_START)));
    (!stacked).then(|| root.to_path_buf())
}

/// Variables clap reads into [`Args`]. clap rejects a blank one instead of
/// using the default, so [`unset_blank_env`] removes it before parsing.
pub const ARGS_ENV_VARS: [&str; 1] = ["RUST_LOG"];

/// Removes each variable in `names` that is set but blank, so `KEY=` reads as
/// unset. Call it before [`Args::parse`].
pub fn unset_blank_env(names: &[&str]) {
    for name in blank_vars(names, |name| std::env::var(name).ok()) {
        std::env::remove_var(name);
    }
}

fn blank_vars<'a>(names: &[&'a str], lookup: impl Fn(&str) -> Option<String>) -> Vec<&'a str> {
    names
        .iter()
        .copied()
        .filter(|name| lookup(name).is_some_and(|value| value.trim().is_empty()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn lookup<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn test_first_set_prefers_the_shared_name() {
        let vars = [("DATABASE_URL", "shared"), ("CONNECTION_STRING", "legacy")];
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&vars)), Some("shared".to_string()));
    }

    #[test]
    fn test_first_set_falls_back_to_the_legacy_name() {
        let vars = [("CONNECTION_STRING", "legacy")];
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&vars)), Some("legacy".to_string()));
    }

    #[test]
    fn test_first_set_skips_empty_values() {
        let vars = [("DATABASE_URL", ""), ("CONNECTION_STRING", "legacy")];
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&vars)), Some("legacy".to_string()));

        let vars = [("DATABASE_URL", "   "), ("CONNECTION_STRING", "legacy")];
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&vars)), Some("legacy".to_string()));

        let vars = [("DATABASE_URL", ""), ("CONNECTION_STRING", "")];
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&vars)), None);
        assert_eq!(first_set(&DATABASE_URL_VARS, lookup(&[])), None);
    }

    /// A checkout in a fresh temporary directory: a linked worktree when
    /// `linked`, with `env` as its root `.env` when given.
    fn checkout(linked: bool, env: Option<&str>) -> PathBuf {
        let root = std::env::temp_dir().join(format!("otr-checkout-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("apps/processor")).unwrap();
        if linked {
            std::fs::write(root.join(".git"), "gitdir: /checkout/.git/worktrees/a\n").unwrap();
        } else {
            std::fs::create_dir(root.join(".git")).unwrap();
        }
        if let Some(env) = env {
            std::fs::write(root.join(".env"), env).unwrap();
        }
        root
    }

    /// The first line of the block `otr up` writes, as apps/scripts defines it.
    fn stack_block_begin() -> String {
        let envfile = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/src/lib/stack/envfile.py"
        ))
        .unwrap();
        let begin = envfile
            .lines()
            .find_map(|line| line.strip_prefix("BEGIN = \"")?.strip_suffix('"'))
            .expect("envfile.py defines BEGIN");
        assert!(begin.starts_with(STACK_BLOCK_START), "{begin}");
        begin.to_string()
    }

    const DEVELOPER_DATABASE: &str = "DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres\n";

    #[test]
    fn test_worktree_without_stack_flags_a_copied_env() {
        let root = checkout(true, Some(DEVELOPER_DATABASE));

        let found = worktree_without_stack(&root.join("apps/processor"), Some(&root.join(".env")));

        assert_eq!(found, Some(root.clone()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn test_worktree_without_stack_flags_an_env_found_outside_the_worktree() {
        let main = checkout(false, Some(DEVELOPER_DATABASE));
        let root = main.join(".claude/worktrees/a");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(".git"), "gitdir: /checkout/.git/worktrees/a\n").unwrap();

        let found = worktree_without_stack(&root, Some(&main.join(".env")));

        assert_eq!(found, Some(root));
        std::fs::remove_dir_all(main).unwrap();
    }

    #[test]
    fn test_worktree_without_stack_accepts_a_stack_block() {
        let env = format!(
            "{DEVELOPER_DATABASE}\n{}\nDATABASE_URL=postgresql://postgres:password@127.0.0.1:20011/postgres\n# <<< otr stack\n",
            stack_block_begin()
        );
        let root = checkout(true, Some(&env));

        let found = worktree_without_stack(&root.join("apps/processor"), Some(&root.join(".env")));

        assert_eq!(found, None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn test_worktree_without_stack_leaves_a_directory_outside_any_checkout_alone() {
        // The production image runs the binary with no checkout and no .env.
        let dir = std::env::temp_dir().join(format!("otr-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        assert_eq!(worktree_without_stack(&dir, None), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn test_worktree_without_stack_leaves_the_main_checkout_alone() {
        let root = checkout(false, Some(DEVELOPER_DATABASE));

        let found = worktree_without_stack(&root.join("apps/processor"), Some(&root.join(".env")));

        assert_eq!(found, None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn test_blank_vars_finds_only_blank_values() {
        let names = ["EMPTY", "SPACES", "SET"];
        let vars = [("EMPTY", ""), ("SPACES", "   "), ("SET", "value")];
        assert_eq!(blank_vars(&names, lookup(&vars)), ["EMPTY", "SPACES"]);
        assert!(blank_vars(&names, lookup(&[])).is_empty());
    }

    #[test]
    #[serial]
    fn test_args_use_defaults_once_blank_env_is_unset() {
        let saved: Vec<_> = ARGS_ENV_VARS
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();
        for name in ARGS_ENV_VARS {
            std::env::set_var(name, "");
        }

        assert!(Args::try_parse_from(["otr-processor"]).is_err());

        unset_blank_env(&ARGS_ENV_VARS);
        let args = Args::try_parse_from(["otr-processor"]);

        for (name, value) in saved {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name)
            }
        }

        let args = args.expect("blank variables should fall back to the defaults");
        assert_eq!(args.log_level, "info");
    }
}
