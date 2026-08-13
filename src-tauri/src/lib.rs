#![forbid(unsafe_code)]

mod phase1;
mod phase2;

use querynot_core::generated::contracts::{ApplicationStatusResponse, CONTRACT_VERSION};
use tauri::Manager;

#[tauri::command]
fn application_status() -> ApplicationStatusResponse {
    ApplicationStatusResponse {
        contract_version: CONTRACT_VERSION,
        phase: "phase_3_mysql_family_parity".to_owned(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<phase1::AppRuntimeState>();
                state.cleanup_window();
            }
        })
        .setup(|app| {
            let state = tauri::async_runtime::block_on(phase1::AppRuntimeState::initialize(
                app.handle().clone(),
            ))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            application_status,
            phase1::bootstrap_workspace,
            phase1::create_profile,
            phase1::update_profile,
            phase1::duplicate_profile,
            phase1::delete_profile,
            phase1::save_profile_secret,
            phase1::remove_profile_secret,
            phase1::save_settings,
            phase1::reset_settings,
            phase1::save_workspace,
            phase1::create_offline_tab,
            phase1::close_offline_tab,
            phase1::pick_sql_file,
            phase1::pick_sqlite_file,
            phase1::pick_new_sqlite_file,
            phase1::pick_tls_ca_file,
            phase1::pick_tls_client_certificate_file,
            phase1::pick_tls_client_key_file,
            phase1::diagnostics_preview,
            phase1::export_diagnostics,
            phase1::clear_operational_log,
            phase2::test_profile_connection,
            phase2::connect_profile,
            phase2::cancel_profile_connection,
            phase2::disconnect_profile,
            phase2::open_tab_session,
            phase2::close_tab_session,
            phase2::load_schema_namespaces,
            phase2::load_schema_objects,
            phase2::load_schema_object_detail,
            phase2::format_sql,
            phase2::start_execution,
            phase2::ack_result_batch,
            phase2::load_more_results,
            phase2::discard_result,
            phase2::cancel_execution,
            phase2::set_transaction_mode,
            phase2::commit_transaction,
            phase2::rollback_transaction,
            phase2::export_result,
        ])
        .run(tauri::generate_context!())
        .expect("QueryNot desktop runtime failed");
}
