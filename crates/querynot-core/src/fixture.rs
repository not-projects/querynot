use std::{fs, path::Path};

use secrecy::SecretString;
use serde::Deserialize;
use zeroize::Zeroize;

use crate::{DatabaseFamily, QueryNotError};

pub const FIXTURE_SCHEMA: &str = "querynot_fixture";
pub const MARKER_TABLE: &str = "querynot_fixture.__querynot_fixture_marker";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureManifest {
    pub generated_for: String,
    pub marker_token: SecretString,
    pub targets: Vec<FixtureTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureTarget {
    pub id: String,
    pub family: DatabaseFamily,
    pub expected_product: String,
    pub expected_version_prefix: String,
    pub expected_authentication_plugin: String,
    pub connection_url: SecretString,
    pub require_tls_version: Option<String>,
    pub require_verified_tls: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarkerProof {
    pub target_id: String,
    pub marker_matches: bool,
}

impl FixtureManifest {
    pub fn from_explicit_path(path: &Path) -> Result<Self, QueryNotError> {
        if !path.is_absolute() {
            return Err(QueryNotError::fixture(
                "fixture manifest path must be absolute; discovery is forbidden",
            ));
        }

        let metadata = fs::symlink_metadata(path)
            .map_err(|_| QueryNotError::fixture("fixture manifest is unavailable"))?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(QueryNotError::fixture(
                "fixture manifest must be a regular, non-symlink file",
            ));
        }

        let mut serialized = fs::read_to_string(path)
            .map_err(|_| QueryNotError::fixture("fixture manifest could not be read"))?;
        let parsed = serde_json::from_str(&serialized)
            .map_err(|_| QueryNotError::fixture("fixture manifest is invalid"));
        serialized.zeroize();

        let manifest: Self = parsed?;
        if manifest.generated_for != "querynot-disposable-fixture-v1"
            || manifest.marker_token.expose_secret().len() < 32
            || manifest.targets.is_empty()
        {
            return Err(QueryNotError::fixture(
                "fixture manifest lacks the generated QueryNot marker",
            ));
        }

        Ok(manifest)
    }
}

use secrecy::ExposeSecret;

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::FixtureManifest;

    #[test]
    fn rejects_relative_fixture_paths_without_discovery() {
        let error = FixtureManifest::from_explicit_path(Path::new("fixture.json"))
            .expect_err("relative fixture path must fail closed");

        assert!(error.safe_message.contains("absolute"));
    }
}
