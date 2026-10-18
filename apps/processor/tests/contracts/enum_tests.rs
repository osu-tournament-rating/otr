//! The processor reads and writes enum columns as numbers, so its enums must
//! number their variants exactly as `@otr/core` does. It also inserts the data
//! worker's tournament stats jobs with raw SQL. These tests read the
//! TypeScript source, because TypeScript cannot see the processor's copies.

use otr_processor::{
    database::jobs::TOURNAMENT_STATS_QUEUE,
    model::structures::{rating_adjustment_type::RatingAdjustmentType, ruleset::Ruleset}
};
use std::{collections::BTreeMap, fmt::Debug, fs};
use strum::IntoEnumIterator;

/// `@otr/core`'s source, from the otr root.
const CORE_SRC: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/otr-core/src");

/// `@otr/core`'s persisted osu! and o!TR enums.
const CORE_ENUMS: &str = "osu/enums.ts";

/// `@otr/core`'s job enums.
const JOB_ENUMS: &str = "jobs/enums.ts";

/// `@otr/core`'s job priorities.
const MESSAGE_VALUES: &str = "messages/values.ts";

/// The processor's SQL selects verified rows with `verification_status = 4`.
const VERIFIED: i64 = 4;

/// The processor leaves `jobs.status` to its column default, which the
/// database tests check is 0. The data worker claims only pending jobs.
const PENDING: i64 = 0;

/// The processor leaves `jobs.priority` to its column default, which the
/// database tests check is 5, so its stats jobs run at normal priority.
const NORMAL_PRIORITY: i64 = 5;

/// Every member of `export enum <name>` in `@otr/core`'s `file`, by name, with
/// its value as written. Panics if a member has no explicit value, since
/// TypeScript would assign one implicitly.
fn core_enum_values(file: &str, name: &str) -> BTreeMap<String, String> {
    let source = fs::read_to_string(format!("{CORE_SRC}/{file}"))
        .unwrap_or_else(|e| panic!("Failed to read @otr/core {file}: {e}"));
    let opening = format!("export enum {name} {{");
    let body = source
        .split_once(&opening)
        .unwrap_or_else(|| panic!("@otr/core {file} no longer exports enum {name}"))
        .1;
    let body = body.split_once('}').expect("Unterminated enum").0;

    body.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("//") && !line.starts_with("/*") && !line.starts_with('*'))
        .map(|line| {
            let (member, value) = line
                .trim_end_matches(',')
                .split_once('=')
                .unwrap_or_else(|| panic!("{name} member `{line}` has no explicit value"));
            (member.trim().to_string(), value.trim().to_string())
        })
        .collect()
}

/// Every member of the numeric `export enum <name>` in `@otr/core`'s `file`.
fn core_enum_in(file: &str, name: &str) -> BTreeMap<String, i64> {
    core_enum_values(file, name)
        .into_iter()
        .map(|(member, value)| {
            let number = value
                .parse()
                .unwrap_or_else(|_| panic!("{name} member {member} = {value} is not a plain number"));
            (member, number)
        })
        .collect()
}

/// Every member of the numeric `export enum <name>` in `@otr/core`'s
/// persisted osu! and o!TR enums.
fn core_enum(name: &str) -> BTreeMap<String, i64> {
    core_enum_in(CORE_ENUMS, name)
}

/// Every member of the string `export enum <name>` in `@otr/core`'s `file`,
/// without its quotes.
fn core_string_enum(file: &str, name: &str) -> BTreeMap<String, String> {
    core_enum_values(file, name)
        .into_iter()
        .map(|(member, value)| {
            let text = ['\'', '"']
                .iter()
                .find_map(|quote| value.strip_prefix(*quote)?.strip_suffix(*quote))
                .unwrap_or_else(|| panic!("{name} member {member} = {value} is not a plain string"))
                .to_string();
            (member, text)
        })
        .collect()
}

/// Every variant of a processor enum, by name.
fn processor_enum<T: IntoEnumIterator + Debug + Copy>(as_number: impl Fn(T) -> i64) -> BTreeMap<String, i64> {
    T::iter()
        .map(|variant| (format!("{variant:?}"), as_number(variant)))
        .collect()
}

#[test]
fn test_ruleset_matches_core() {
    assert_eq!(processor_enum(|r: Ruleset| r as i64), core_enum("Ruleset"));
}

#[test]
fn test_rating_adjustment_type_matches_core() {
    assert_eq!(
        processor_enum(|t: RatingAdjustmentType| t as i64),
        core_enum("RatingAdjustmentType")
    );
}

#[test]
fn test_verified_matches_core() {
    assert_eq!(core_enum("VerificationStatus").get("Verified"), Some(&VERIFIED));
}

#[test]
fn test_tournament_stats_queue_matches_core() {
    assert_eq!(
        core_string_enum(JOB_ENUMS, "JobQueue")
            .get("TournamentStats")
            .map(String::as_str),
        Some(TOURNAMENT_STATS_QUEUE)
    );
}

#[test]
fn test_default_job_status_is_pending_in_core() {
    assert_eq!(core_enum_in(JOB_ENUMS, "JobStatus").get("Pending"), Some(&PENDING));
}

#[test]
fn test_default_job_priority_is_normal_in_core() {
    assert_eq!(
        core_enum_in(MESSAGE_VALUES, "MessagePriority").get("Normal"),
        Some(&NORMAL_PRIORITY)
    );
}
