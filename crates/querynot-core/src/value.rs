use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum TaggedValue {
    Null,
    Text(String),
    Bytes(Vec<u8>),
    SignedInteger(String),
    UnsignedInteger(String),
    Decimal(String),
    Float(f64),
    Boolean(bool),
    DateTime {
        raw: String,
        timezone_or_offset: Option<String>,
    },
    AdapterSpecific {
        type_name: String,
        raw: String,
    },
}

#[cfg(test)]
mod tests {
    use super::TaggedValue;

    #[test]
    fn integers_are_serialized_as_lossless_strings() {
        let value = TaggedValue::UnsignedInteger("18446744073709551615".to_owned());
        let json = serde_json::to_string(&value).expect("tagged value should serialize");

        assert!(json.contains("18446744073709551615"));
        assert!(!json.contains("1.844674407"));
    }
}
