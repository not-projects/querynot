#![forbid(unsafe_code)]

pub mod adapter;
pub mod diagnostics;
pub mod error;
pub mod export;
pub mod fixture;
pub mod generated;
pub mod history;
pub mod ids;
pub mod mysql;
pub mod ownership;
pub mod profile;
pub mod result;
pub mod settings;
pub mod sql;
pub mod sqlite;
pub mod state;
pub mod store;
pub mod table;
pub mod value;
pub mod vault;
pub mod workspace;

pub use adapter::{
    AdapterCapabilities, AdapterConnectionInfo, AdapterSession, CompatibilityStatus,
    DatabaseFamily, ServerIdentity,
};
pub use error::{ErrorCategory, QueryNotError};
pub use fixture::{FixtureManifest, FixtureTarget, MarkerProof};
pub use ids::{
    ExecutionId, ExportId, FileGrantId, HistoryEntryId, MutationPlanId, NativeSessionId, ProfileId,
    ResultSetId, SecretRef, StatementId, TabId, WindowId,
};
pub use value::TaggedValue;
