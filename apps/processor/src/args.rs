use clap::Parser;

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
/// shares; the production cron still passes `CONNECTION_STRING`.
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
