#[cfg(target_os = "windows")]
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

#[cfg(target_os = "windows")]
use querynot_core::generated::contracts::UpdateDownloadProgressView;
use querynot_core::generated::contracts::{
    AvailableUpdateView, ConfirmedActionRequest, FileActionResponse, UpdateCheckResponse,
};
use querynot_core::{ErrorCategory, QueryNotError};
#[cfg(target_os = "windows")]
use tauri::Emitter;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::phase1::AppRuntimeState;

const UPDATE_ENDPOINT: &str =
    "https://github.com/not-projects/querynot/releases/latest/download/latest.json";
const COMPILED_PUBLIC_KEY: Option<&str> = option_env!("QUERYNOT_UPDATER_PUBLIC_KEY");

#[tauri::command]
pub(crate) async fn check_for_updates(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<UpdateCheckResponse, QueryNotError> {
    let Some(public_key) = normalized_public_key(COMPILED_PUBLIC_KEY) else {
        clear_pending_update(&state)?;
        return Ok(UpdateCheckResponse {
            configured: false,
            update: None,
        });
    };
    let endpoint = Url::parse(UPDATE_ENDPOINT)
        .map_err(|_| QueryNotError::internal("The compiled signed-update endpoint is invalid."))?;
    let updater = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(|_| update_check_error())?
        .build()
        .map_err(|_| update_check_error())?;
    let update = updater.check().await.map_err(|_| update_check_error())?;

    if let Some(update) = update {
        let available = AvailableUpdateView {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: update.date.map(|value| value.to_string()),
            body: update.body.clone(),
        };
        set_pending_update(&state, update)?;
        return Ok(UpdateCheckResponse {
            configured: true,
            update: Some(available),
        });
    }

    clear_pending_update(&state)?;
    Ok(UpdateCheckResponse {
        configured: true,
        update: None,
    })
}

#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    request: ConfirmedActionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Installing an application update requires explicit confirmation.",
        ));
    }
    install_update_for_platform(&app, &state).await
}

#[cfg(target_os = "windows")]
async fn install_update_for_platform(
    app: &AppHandle,
    state: &AppRuntimeState,
) -> Result<FileActionResponse, QueryNotError> {
    let update = pending_update(state)?.ok_or_else(|| {
        QueryNotError::authorization(
            "Check for a signed update before asking QueryNot to install it.",
        )
    })?;
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let download_app = app.clone();
    let finish_app = app.clone();
    let download_counter = Arc::clone(&downloaded_bytes);
    let finish_counter = Arc::clone(&downloaded_bytes);

    emit_progress(app, 0, None, false);
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let downloaded = download_counter
                    .fetch_add(chunk_length as u64, Ordering::Relaxed)
                    .saturating_add(chunk_length as u64);
                emit_progress(&download_app, downloaded, content_length, false);
            },
            move || {
                emit_progress(
                    &finish_app,
                    finish_counter.load(Ordering::Relaxed),
                    None,
                    true,
                );
            },
        )
        .await
        .map_err(|_| {
            QueryNotError::database(
                ErrorCategory::Connectivity,
                "The signed update could not be downloaded or applied. The current installation remains available; check the network connection and retry.",
                true,
            )
        })?;
    clear_pending_update(state)?;
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: "The verified Windows update was handed to the installer. QueryNot will close when the installer takes over."
            .to_owned(),
    })
}

#[cfg(not(target_os = "windows"))]
async fn install_update_for_platform(
    _app: &AppHandle,
    _state: &AppRuntimeState,
) -> Result<FileActionResponse, QueryNotError> {
    Err(QueryNotError::database(
        ErrorCategory::UnsupportedCapability,
        "Automatic installation is available only in the supported Windows release package.",
        false,
    ))
}

fn normalized_public_key(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn update_check_error() -> QueryNotError {
    QueryNotError::database(
        ErrorCategory::Connectivity,
        "The signed update feed could not be checked. The application remains usable offline; check the network connection and retry.",
        true,
    )
}

#[cfg(target_os = "windows")]
fn pending_update(
    state: &AppRuntimeState,
) -> Result<Option<tauri_plugin_updater::Update>, QueryNotError> {
    state
        .pending_update
        .lock()
        .map(|update| update.clone())
        .map_err(|_| QueryNotError::internal("The pending update state is unavailable."))
}

fn set_pending_update(
    state: &AppRuntimeState,
    update: tauri_plugin_updater::Update,
) -> Result<(), QueryNotError> {
    *state
        .pending_update
        .lock()
        .map_err(|_| QueryNotError::internal("The pending update state is unavailable."))? =
        Some(update);
    Ok(())
}

fn clear_pending_update(state: &AppRuntimeState) -> Result<(), QueryNotError> {
    *state
        .pending_update
        .lock()
        .map_err(|_| QueryNotError::internal("The pending update state is unavailable."))? = None;
    Ok(())
}

#[cfg(target_os = "windows")]
fn emit_progress(
    app: &AppHandle,
    downloaded_bytes: u64,
    content_length: Option<u64>,
    finished: bool,
) {
    let _ = app.emit(
        "update_download_progress",
        UpdateDownloadProgressView {
            downloaded_bytes,
            content_length,
            finished,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{UPDATE_ENDPOINT, normalized_public_key};

    #[test]
    fn updater_configuration_requires_a_nonempty_compiled_public_key() {
        assert_eq!(normalized_public_key(None), None);
        assert_eq!(normalized_public_key(Some("  ")), None);
        assert_eq!(normalized_public_key(Some(" key\n")), Some("key"));
    }

    #[test]
    fn stable_feed_is_scoped_to_querynot_latest_release() {
        assert_eq!(
            UPDATE_ENDPOINT,
            "https://github.com/not-projects/querynot/releases/latest/download/latest.json"
        );
    }
}
