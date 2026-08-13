#![forbid(unsafe_code)]

pub mod adapter;
pub mod error;
pub mod fixture;
pub mod generated;
pub mod ids;
pub mod value;

pub use adapter::{AdapterCapabilities, DatabaseFamily, ServerIdentity};
pub use error::{ErrorCategory, QueryNotError};
pub use fixture::{FixtureManifest, FixtureTarget, MarkerProof};
pub use ids::{ExecutionId, NativeSessionId, ProfileId, ResultSetId, TabId};
pub use value::TaggedValue;
