use crate::{ProfileId, SecretRef};
use secrecy::{ExposeSecret, SecretString};
use std::collections::HashMap;

pub const VAULT_SERVICE: &str = "com.notprojects.querynot";

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
    secrets: HashMap<ProfileId, SecretString>,
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
    pub fn replace(&mut self, profile_id: ProfileId, secret: SecretString) {
        self.secrets.insert(profile_id, secret);
    }

    #[must_use]
    pub fn get(&self, profile_id: ProfileId) -> Option<&SecretString> {
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
            SecretString::new("transient".to_owned().into_boxed_str()),
        );
        assert_eq!(store.get(profile).unwrap().expose_secret(), "transient");
        store.remove(profile);
        assert!(store.get(profile).is_none());
    }
}
