use serde_repr::{Deserialize_repr, Serialize_repr};
use std::convert::TryFrom;
use strum_macros::EnumIter;

#[derive(Deserialize_repr, Serialize_repr, Debug, Clone, Copy, PartialEq, Eq, Hash, EnumIter)]
#[repr(u8)]
pub enum RatingAdjustmentType {
    Initial = 0,
    Decay = 1,
    Match = 2,
    VolatilityDecay = 3
}

impl TryFrom<i32> for RatingAdjustmentType {
    type Error = ();
    fn try_from(v: i32) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(RatingAdjustmentType::Initial),
            1 => Ok(RatingAdjustmentType::Decay),
            2 => Ok(RatingAdjustmentType::Match),
            3 => Ok(RatingAdjustmentType::VolatilityDecay),
            _ => Err(())
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::model::structures::rating_adjustment_type::RatingAdjustmentType;
    use strum::IntoEnumIterator;

    #[test]
    fn test_try_from_round_trip() {
        for adjustment_type in RatingAdjustmentType::iter() {
            assert_eq!(
                RatingAdjustmentType::try_from(adjustment_type as i32),
                Ok(adjustment_type)
            );
        }

        assert_eq!(RatingAdjustmentType::try_from(4), Err(()));
    }
}
