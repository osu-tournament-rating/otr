//! The receipt of a committed rating run.
//!
//! Once a run's transaction commits, the processor prints one line to stdout:
//! [`RECEIPT_PREFIX`] followed by the receipt as compact JSON. Nothing else
//! goes to stdout, since every log line goes to stderr. The scripts in
//! `apps/scripts` read the line, add the image they ran, and publish the
//! receipt beside the public replicas, where otr-replay reads it. The field
//! names and the timestamp format are a contract with both.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Serialize, Serializer};

/// Starts the stdout line that carries a run's receipt.
pub const RECEIPT_PREFIX: &str = "OTR_RECEIPT=";

/// How much a run read and wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RunCounts {
    /// Verified matches the run rated.
    pub matches: usize,
    /// Players the run read.
    pub players: usize,
    /// Tournaments of the rated matches.
    pub tournaments: usize,
    /// Player ratings the run saved, one per player and ruleset.
    pub ratings: usize,
    /// Tournament stats jobs the run queued.
    pub stats_jobs: usize
}

/// What a committed run did, and when.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunReceipt {
    /// The run id, which every stats job the run queued carries as its
    /// correlation id.
    pub run_id: String,
    /// When the process started.
    #[serde(serialize_with = "utc")]
    pub started_at: DateTime<Utc>,
    /// The time the final decay pass ran to. Decay adjustments after it did
    /// not exist when the run's ratings were published.
    #[serde(serialize_with = "optional_utc")]
    pub decay_horizon: Option<DateTime<Utc>>,
    /// When the transaction committed, which is when the ratings were published.
    #[serde(serialize_with = "utc")]
    pub committed_at: DateTime<Utc>,
    pub counts: RunCounts
}

impl RunReceipt {
    /// The stdout line that carries this receipt.
    pub fn line(&self) -> serde_json::Result<String> {
        Ok(format!("{RECEIPT_PREFIX}{}", serde_json::to_string(self)?))
    }
}

/// RFC 3339 in UTC with microseconds and a `Z`, which Python's
/// `datetime.fromisoformat` reads.
fn utc<S: Serializer>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_rfc3339_opts(SecondsFormat::Micros, true))
}

fn optional_utc<S: Serializer>(value: &Option<DateTime<Utc>>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => utc(value, serializer),
        None => serializer.serialize_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn receipt(decay_horizon: Option<DateTime<Utc>>) -> RunReceipt {
        RunReceipt {
            run_id: "7d4c2f9e-0000-4000-8000-000000000001".to_string(),
            started_at: Utc.with_ymd_and_hms(2026, 10, 20, 12, 0, 4).unwrap(),
            decay_horizon,
            committed_at: Utc.with_ymd_and_hms(2026, 10, 20, 12, 3, 10).unwrap() + chrono::Duration::microseconds(250),
            counts: RunCounts {
                matches: 11,
                players: 22,
                tournaments: 3,
                ratings: 40,
                stats_jobs: 2
            }
        }
    }

    /// apps/scripts/src/lib/receipt.py and otr-replay read these names and
    /// this timestamp format.
    #[test]
    fn test_line_is_the_prefix_and_the_receipt_as_one_json_line() {
        let horizon = Utc.with_ymd_and_hms(2026, 10, 20, 12, 1, 30).unwrap();
        let line = receipt(Some(horizon)).line().unwrap();

        assert_eq!(
            line,
            "OTR_RECEIPT={\"run_id\":\"7d4c2f9e-0000-4000-8000-000000000001\",\
             \"started_at\":\"2026-10-20T12:00:04.000000Z\",\
             \"decay_horizon\":\"2026-10-20T12:01:30.000000Z\",\
             \"committed_at\":\"2026-10-20T12:03:10.000250Z\",\
             \"counts\":{\"matches\":11,\"players\":22,\"tournaments\":3,\"ratings\":40,\"stats_jobs\":2}}"
        );
    }
}
