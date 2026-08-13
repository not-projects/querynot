#![forbid(unsafe_code)]

use querynot_core::generated::contracts::{ApplicationStatusResponse, CONTRACT_VERSION};

#[tauri::command]
fn application_status() -> ApplicationStatusResponse {
    ApplicationStatusResponse {
        contract_version: CONTRACT_VERSION,
        phase: "phase_0_foundation".to_owned(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![application_status])
        .run(tauri::generate_context!())
        .expect("QueryNot desktop runtime failed");
}
