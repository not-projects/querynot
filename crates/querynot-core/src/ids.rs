use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }

            #[must_use]
            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(value).map(Self)
            }
        }
    };
}

opaque_id!(WindowId);
opaque_id!(ProfileId);
opaque_id!(TabId);

impl ProfileId {
    #[must_use]
    pub const fn nil() -> Self {
        Self(Uuid::nil())
    }

    #[must_use]
    pub const fn is_nil(&self) -> bool {
        self.0.is_nil()
    }
}

opaque_id!(NativeSessionId);
opaque_id!(ExecutionId);
opaque_id!(ResultSetId);
opaque_id!(StatementId);
opaque_id!(ExportId);
opaque_id!(MutationPlanId);
opaque_id!(HistoryEntryId);
opaque_id!(SecretRef);
opaque_id!(FileGrantId);

#[cfg(test)]
mod tests {
    use super::ProfileId;
    use std::str::FromStr;

    #[test]
    fn opaque_ids_round_trip_but_remain_typed() {
        let id = ProfileId::new();
        assert_eq!(ProfileId::from_str(&id.to_string()), Ok(id));
        assert!(ProfileId::from_str("../../not-an-id").is_err());
    }

    #[test]
    fn nil_profile_id_is_stable_and_never_issued_by_new() {
        assert_eq!(
            ProfileId::nil().to_string(),
            "00000000-0000-0000-0000-000000000000"
        );
        assert!(ProfileId::nil().is_nil());
        assert!(!ProfileId::new().is_nil());
    }
}
