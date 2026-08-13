use crate::{ProfileId, SecretRef};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zeroize::Zeroizing;

pub const VAULT_SERVICE: &str = "com.notprojects.querynot";
const SECRET_BUNDLE_PREFIX: &str = "querynot-secret-bundle-v1:";

pub struct ConnectionSecrets {
    database_password: SecretString,
    client_key_passphrase: SecretString,
}

impl Clone for ConnectionSecrets {
    fn clone(&self) -> Self {
        Self::new(
            self.database_password.expose_secret(),
            self.client_key_passphrase.expose_secret(),
        )
    }
}

impl std::fmt::Debug for ConnectionSecrets {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectionSecrets")
            .field("database_password", &"[REDACTED]")
            .field("client_key_passphrase", &"[REDACTED]")
            .finish()
    }
}

impl ConnectionSecrets {
    #[must_use]
    pub fn new(
        database_password: impl Into<String>,
        client_key_passphrase: impl Into<String>,
    ) -> Self {
        Self {
            database_password: SecretString::new(database_password.into().into_boxed_str()),
            client_key_passphrase: SecretString::new(client_key_passphrase.into().into_boxed_str()),
        }
    }

    #[must_use]
    pub fn empty() -> Self {
        Self::new(String::new(), String::new())
    }

    #[must_use]
    pub fn database_password(&self) -> &SecretString {
        &self.database_password
    }

    #[must_use]
    pub fn client_key_passphrase(&self) -> &SecretString {
        &self.client_key_passphrase
    }

    pub fn encode_for_vault(&self) -> Result<SecretString, VaultError> {
        #[derive(Serialize)]
        struct Payload<'a> {
            database_password: &'a str,
            client_key_passphrase: &'a str,
        }
        let serialized = Zeroizing::new(
            serde_json::to_string(&Payload {
                database_password: self.database_password.expose_secret(),
                client_key_passphrase: self.client_key_passphrase.expose_secret(),
            })
            .map_err(|_| VaultError {
                kind: VaultFailureKind::Rejected,
                safe_message: "The credential bundle could not be prepared safely.".to_owned(),
                session_only_available: true,
            })?,
        );
        let mut encoded = Zeroizing::new(String::with_capacity(
            SECRET_BUNDLE_PREFIX.len() + serialized.len(),
        ));
        encoded.push_str(SECRET_BUNDLE_PREFIX);
        encoded.push_str(&serialized);
        Ok(SecretString::new(encoded.to_string().into_boxed_str()))
    }

    pub fn decode_from_vault(value: SecretString) -> Result<Self, VaultError> {
        let exposed = value.expose_secret();
        let Some(serialized) = exposed.strip_prefix(SECRET_BUNDLE_PREFIX) else {
            // Version 0 stored the database password directly. Read it without
            // rewriting so existing vault entries remain usable.
            return Ok(Self::new(exposed, String::new()));
        };
        #[derive(Deserialize)]
        struct Payload {
            database_password: String,
            client_key_passphrase: String,
        }
        let payload: Payload = serde_json::from_str(serialized).map_err(|_| VaultError {
            kind: VaultFailureKind::Rejected,
            safe_message: "The saved credential bundle is invalid and was not used.".to_owned(),
            session_only_available: true,
        })?;
        Ok(Self::new(
            payload.database_password,
            payload.client_key_passphrase,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultFailureKind {
    Locked,
    Unavailable,
    Rejected,
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("{safe_message}")]
pub struct VaultError {
    pub kind: VaultFailureKind,
    pub safe_message: String,
    pub session_only_available: bool,
}

pub trait SecretVault: Send + Sync {
    fn store(&self, reference: SecretRef, secret: &SecretString) -> Result<(), VaultError>;
    fn retrieve(&self, reference: SecretRef) -> Result<SecretString, VaultError>;
    fn delete(&self, reference: SecretRef) -> Result<(), VaultError>;
}

#[derive(Clone, Debug, Default)]
pub struct KeyringVault;

impl KeyringVault {
    fn entry(reference: SecretRef) -> Result<keyring::Entry, VaultError> {
        keyring::Entry::new(VAULT_SERVICE, &reference.to_string()).map_err(map_keyring_error)
    }
}

impl SecretVault for KeyringVault {
    fn store(&self, reference: SecretRef, secret: &SecretString) -> Result<(), VaultError> {
        Self::entry(reference)?
            .set_password(secret.expose_secret())
            .map_err(map_keyring_error)
    }

    fn retrieve(&self, reference: SecretRef) -> Result<SecretString, VaultError> {
        let value = Self::entry(reference)?
            .get_password()
            .map_err(map_keyring_error)?;
        Ok(SecretString::new(value.into_boxed_str()))
    }

    fn delete(&self, reference: SecretRef) -> Result<(), VaultError> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

fn map_keyring_error(error: keyring::Error) -> VaultError {
    let kind = match error {
        keyring::Error::NoEntry => VaultFailureKind::Missing,
        keyring::Error::PlatformFailure(_) => VaultFailureKind::Unavailable,
        keyring::Error::Ambiguous(_) => VaultFailureKind::Locked,
        _ => VaultFailureKind::Rejected,
    };
    let safe_message = match kind {
        VaultFailureKind::Locked => "The operating-system credential vault is locked.",
        VaultFailureKind::Unavailable => {
            "The operating-system credential vault is unavailable. The secret was not saved."
        }
        VaultFailureKind::Rejected => {
            "The operating-system credential vault rejected the request. The secret was not saved."
        }
        VaultFailureKind::Missing => "The saved credential no longer exists in the vault.",
    };
    VaultError {
        kind,
        safe_message: safe_message.to_owned(),
        session_only_available: kind != VaultFailureKind::Missing,
    }
}

#[derive(Default)]
pub struct SessionSecretStore {
    secrets: HashMap<ProfileId, ConnectionSecrets>,
}

impl std::fmt::Debug for SessionSecretStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionSecretStore")
            .field("profiles", &self.secrets.len())
            .field("values", &"[REDACTED]")
            .finish()
    }
}

impl SessionSecretStore {
    pub fn replace(&mut self, profile_id: ProfileId, secret: ConnectionSecrets) {
        self.secrets.insert(profile_id, secret);
    }

    #[must_use]
    pub fn get(&self, profile_id: ProfileId) -> Option<&ConnectionSecrets> {
        self.secrets.get(&profile_id)
    }

    pub fn remove(&mut self, profile_id: ProfileId) {
        self.secrets.remove(&profile_id);
    }

    pub fn clear(&mut self) {
        self.secrets.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FaultVault {
        value: Mutex<Option<String>>,
        reject_writes: Mutex<bool>,
    }

    impl SecretVault for FaultVault {
        fn store(&self, _reference: SecretRef, secret: &SecretString) -> Result<(), VaultError> {
            if *self.reject_writes.lock().unwrap() {
                return Err(VaultError {
                    kind: VaultFailureKind::Rejected,
                    safe_message: "Vault rejected the write; session-only use remains available."
                        .to_owned(),
                    session_only_available: true,
                });
            }
            *self.value.lock().unwrap() = Some(secret.expose_secret().to_owned());
            Ok(())
        }

        fn retrieve(&self, _reference: SecretRef) -> Result<SecretString, VaultError> {
            self.value
                .lock()
                .unwrap()
                .clone()
                .map(|value| SecretString::new(value.into_boxed_str()))
                .ok_or(VaultError {
                    kind: VaultFailureKind::Missing,
                    safe_message: "missing".to_owned(),
                    session_only_available: false,
                })
        }

        fn delete(&self, _reference: SecretRef) -> Result<(), VaultError> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn rejected_replacement_preserves_existing_secret_and_never_formats_it() {
        let vault = FaultVault::default();
        let reference = SecretRef::new();
        let original = SecretString::new("original-secret".to_owned().into_boxed_str());
        vault.store(reference, &original).unwrap();
        *vault.reject_writes.lock().unwrap() = true;
        let replacement = SecretString::new("replacement-secret".to_owned().into_boxed_str());
        let error = vault.store(reference, &replacement).unwrap_err();

        assert!(error.session_only_available);
        assert_eq!(
            vault.retrieve(reference).unwrap().expose_secret(),
            "original-secret"
        );
        assert!(!format!("{original:?} {replacement:?} {error:?}").contains("secret"));
    }

    #[test]
    fn session_secrets_are_removed_explicitly() {
        let profile = ProfileId::new();
        let mut store = SessionSecretStore::default();
        store.replace(
            profile,
            ConnectionSecrets::new("transient", "key-passphrase"),
        );
        assert_eq!(
            store
                .get(profile)
                .unwrap()
                .database_password()
                .expose_secret(),
            "transient"
        );
        store.remove(profile);
        assert!(store.get(profile).is_none());
    }

    #[test]
    fn vault_bundle_round_trips_both_secrets_and_reads_legacy_passwords() {
        let bundle = ConnectionSecrets::new("database-password", "client-key-passphrase");
        let encoded = bundle.encode_for_vault().unwrap();
        assert!(!format!("{encoded:?}").contains("database-password"));
        let decoded = ConnectionSecrets::decode_from_vault(encoded).unwrap();
        assert_eq!(
            decoded.database_password().expose_secret(),
            "database-password"
        );
        assert_eq!(
            decoded.client_key_passphrase().expose_secret(),
            "client-key-passphrase"
        );

        let legacy = ConnectionSecrets::decode_from_vault(SecretString::new(
            "legacy-password".to_owned().into_boxed_str(),
        ))
        .unwrap();
        assert_eq!(
            legacy.database_password().expose_secret(),
            "legacy-password"
        );
        assert!(legacy.client_key_passphrase().expose_secret().is_empty());
    }
}
