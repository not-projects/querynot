use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseFamily {
    Sqlite,
    MySqlFamily,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServerIdentity {
    pub family: DatabaseFamily,
    pub product: String,
    pub exact_version: String,
    pub legacy: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AdapterCapabilities {
    pub metadata: bool,
    pub streaming: bool,
    pub cancellation: bool,
    pub transactions: bool,
    pub multiple_results: bool,
    pub safe_table_mutations: bool,
}
