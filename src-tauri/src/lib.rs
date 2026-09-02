#![forbid(unsafe_code)]

mod phase1;
mod phase2;
mod updates;

use querynot_core::generated::contracts::{ApplicationStatusResponse, CONTRACT_VERSION};
use tauri::Manager;

#[tauri::command]
fn application_status() -> ApplicationStatusResponse {
    ApplicationStatusResponse {
        contract_version: CONTRACT_VERSION,
        phase: "phase_4_productivity_and_safe_data_editing".to_owned(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let cwd = std::path::PathBuf::from(cwd);
            let paths = args.into_iter().skip(1).map(|argument| {
                let path = std::path::PathBuf::from(argument);
                if path.is_absolute() {
                    path
                } else {
                    cwd.join(path)
                }
            });
            phase1::route_sql_file_paths(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            let maintenance_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
                interval.tick().await;
                loop {
                    interval.tick().await;
                    let state = maintenance_app.state::<phase1::AppRuntimeState>();
                    phase1::run_history_maintenance(&state).await;
                }
            });
            #[cfg(not(target_os = "macos"))]
            {
                let cwd = std::env::current_dir().unwrap_or_default();
                let paths = std::env::args_os().skip(1).map(|argument| {
                    let path = std::path::PathBuf::from(argument);
                    if path.is_absolute() {
                        path
                    } else {
                        cwd.join(path)
                    }
                });
                phase1::route_sql_file_paths(app.handle(), paths);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            application_status,
            updates::check_for_updates,
            updates::install_update,
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
            phase1::clear_saved_workspace,
            phase1::create_offline_tab,
            phase1::close_offline_tab,
            phase1::pick_sql_file,
            phase1::save_sql_file,
            phase1::save_sql_file_as,
            phase1::review_sql_file,
            phase1::take_pending_sql_files,
            phase1::pick_connection_file,
            phase1::pick_tls_ca_file,
            phase1::pick_tls_client_certificate_file,
            phase1::pick_tls_client_key_file,
            phase1::diagnostics_preview,
            phase1::export_diagnostics,
            phase1::clear_operational_log,
            phase1::list_history,
            phase1::delete_history_entry,
            phase1::clear_history,
            phase2::test_profile_connection,
            phase2::connect_profile,
            phase2::cancel_profile_connection,
            phase2::disconnect_profile,
            phase2::open_tab_session,
            phase2::close_tab_session,
            phase2::load_schema_namespaces,
            phase2::load_schema_objects,
            phase2::load_schema_object_detail,
            phase2::qualified_schema_name,
            phase2::starter_query,
            phase2::browse_table,
            phase2::preview_table_mutations,
            phase2::apply_table_mutations,
            phase2::discard_mutation_plan,
            phase2::change_tab_context,
            phase2::format_sql,
            phase2::start_execution,
            phase2::start_explain,
            phase2::ack_result_batch,
            phase2::load_more_results,
            phase2::discard_result,
            phase2::cancel_execution,
            phase2::set_transaction_mode,
            phase2::commit_transaction,
            phase2::rollback_transaction,
            phase2::export_result,
        ])
        .build(tauri::generate_context!())
        .expect("QueryNot desktop runtime failed to build");
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            phase1::route_sql_file_paths(
                app_handle,
                urls.into_iter().filter_map(|url| url.to_file_path().ok()),
            );
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
