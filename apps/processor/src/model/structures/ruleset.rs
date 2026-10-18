use serde_repr::{Deserialize_repr, Serialize_repr};
use std::convert::TryFrom;
use strum_macros::EnumIter;

#[derive(Deserialize_repr, Serialize_repr, Debug, Clone, Copy, PartialEq, Eq, Hash, EnumIter)]
#[repr(i32)]
pub enum Ruleset {
    Osu = 0,
    Taiko = 1,
    Catch = 2,
    ManiaOther = 3,
    Mania4k = 4,
    Mania7k = 5
}

impl TryFrom<i32> for Ruleset {
    type Error = ();

    fn try_from(v: i32) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Ruleset::Osu),
            1 => Ok(Ruleset::Taiko),
            2 => Ok(Ruleset::Catch),
            3 => Ok(Ruleset::ManiaOther),
            4 => Ok(Ruleset::Mania4k),
            5 => Ok(Ruleset::Mania7k),
            _ => Err(())
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::model::structures::ruleset::Ruleset;
    use strum::IntoEnumIterator;

    /// The database stores rulesets as numbers, so each one must read back as itself
    #[test]
    fn test_try_from_round_trip() {
        for ruleset in Ruleset::iter() {
            assert_eq!(Ruleset::try_from(ruleset as i32), Ok(ruleset));
        }

        assert_eq!(Ruleset::try_from(-1), Err(()));
        assert_eq!(Ruleset::try_from(6), Err(()));
    }
}
